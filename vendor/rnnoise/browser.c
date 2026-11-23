#include "rnnoise.h"

/* Browser adapter. One model state and one reusable 10 ms mono frame per instance. */
static DenoiseState *state;
static float frame[480];

int noise_create(void) {
  if (state) rnnoise_destroy(state);
  state = rnnoise_create(NULL);
  return state != NULL;
}

float *noise_frame(void) { return frame; }

void noise_process(void) { rnnoise_process_frame(state, frame, frame); }

void noise_destroy(void) {
  if (state) rnnoise_destroy(state);
  state = NULL;
}
