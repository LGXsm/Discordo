/* RNNoise license
Copyright (c) 2007-2017, 2024 Jean-Marc Valin
Copyright (c) 2023 Amazon
Copyright (c) 2017, Mozilla
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.Org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
// RNNoise uses 480-sample frames at 48 kHz. Web Audio supplies smaller render blocks.
class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const instance = new WebAssembly.Instance(options.processorOptions.module, {});
    this.engine = instance.exports;
    this.engine._initialize?.();
    if (!this.engine.noise_create()) throw new Error('RNNoise initialization failed');
    this.frame = new Float32Array(this.engine.memory.buffer, this.engine.noise_frame(), 480);
    this.queue = new Float32Array(1920);
    this.inputIndex = 0;
    this.readIndex = 0;
    this.writeIndex = 480;
    this.enabled = options.processorOptions.enabled;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') {
        this.engine.noise_destroy();
        this.stopped = true;
      } else if (data.type === 'enabled') {
        this.enabled = data.enabled;
        this.inputIndex = 0;
        this.readIndex = 0;
        this.writeIndex = 480;
        this.queue.fill(0);
        if (this.enabled) this.engine.noise_create();
      }
    };
    this.port.postMessage({ type: 'ready' });
  }

  process(inputs, outputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    if (!this.enabled) {
      output.set(input);
      return true;
    }
    for (let i = 0; i < output.length; i++) {
      this.frame[this.inputIndex++] = input[i] * 32768;
      if (this.inputIndex === 480) {
        this.engine.noise_process();
        for (let j = 0; j < 480; j++) {
          this.queue[this.writeIndex] = this.frame[j] / 32768;
          this.writeIndex = (this.writeIndex + 1) % this.queue.length;
        }
        this.inputIndex = 0;
      }
      output[i] = this.queue[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.queue.length;
    }
    return true;
  }
}

registerProcessor('discordo-rnnoise', RNNoiseProcessor);
