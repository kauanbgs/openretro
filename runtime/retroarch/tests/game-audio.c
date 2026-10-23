#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include "openretro_game_audio.h"
int main(void) {
   struct openretro_audio_ring ring = {0};
   const float stereo[] = {1.0f, -1.0f, 2.0f, -2.0f, 0.5f, 0.0f};
   ring.written = OPENRETRO_AUDIO_FRAMES - 1;
   assert(offsetof(struct openretro_audio_ring, samples) == 32);
   openretro_audio_store(&ring, stereo, 3, 48000);
   assert(ring.rate == 48000 && ring.written == OPENRETRO_AUDIO_FRAMES + 2);
   assert(ring.samples[(OPENRETRO_AUDIO_FRAMES - 1) * 2] == 32767);
   assert(ring.samples[(OPENRETRO_AUDIO_FRAMES - 1) * 2 + 1] == -32767);
   assert(ring.samples[0] == 32767 && ring.samples[1] == -32767);
   assert(ring.samples[2] == 16383 && ring.samples[3] == 0);
   ring.written = UINT32_MAX;
   openretro_audio_store(&ring, stereo, 1, 44100);
   assert(ring.written == 0 && ring.rate == 44100);
   {
      size_t frames = OPENRETRO_AUDIO_FRAMES + 10;
      float *large = (float*)calloc(frames * 2, sizeof(float));
      large[(frames - 1) * 2] = 0.5f;
      openretro_audio_store(&ring, large, frames, 48000);
      assert(ring.written == frames);
      assert(ring.samples[((frames - 1) % OPENRETRO_AUDIO_FRAMES) * 2] == 16383);
      free(large);
   }
   puts("Game audio ring: layout, stereo, clipping, wrap and overrun passed.");
   return 0;
}
