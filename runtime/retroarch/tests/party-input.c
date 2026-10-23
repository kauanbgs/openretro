#include <assert.h>
#include <stdio.h>
#include "openretro_party_input.h"
int main(void)
{
   const int16_t neutral[4] = {0, 0, 0, 0};
   const int16_t sticks[4] = {-32768, 1200, 32767, -16000};
   uint64_t buttons = (UINT64_C(1) << RETRO_DEVICE_ID_JOYPAD_A)
                   | (UINT64_C(1) << RETRO_DEVICE_ID_JOYPAD_R3);
   unsigned id;
   /* Only J1 local input follows focus, and only while Party is active. */
   assert(openretro_party_local_input_allowed(false, 0, false));
   assert(openretro_party_local_input_allowed(false, 0, true));
   assert(openretro_party_local_input_allowed(true, 0, true));
   assert(!openretro_party_local_input_allowed(true, 0, false));
   assert(openretro_party_local_input_allowed(true, 1, false));
   assert(openretro_party_local_input_allowed(true, 2, false));
   assert(openretro_party_local_input_allowed(true, 3, false));
   /* Neutral remote input must remain neutral, never local fallback. */
   for (id = 0; id < 16; id++)
      assert(openretro_party_input(RETRO_DEVICE_JOYPAD, 0, id, 0, neutral) == 0);
   assert(openretro_party_input(RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_MASK, 0, neutral) == 0);
   assert((uint16_t)openretro_party_input(RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_MASK, buttons, neutral) == (uint16_t)buttons);
   assert(openretro_party_input(RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A, buttons, neutral) == 1);
   assert(openretro_party_input(RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_B, buttons, neutral) == 0);
   assert(openretro_party_input(RETRO_DEVICE_ANALOG, 0, 0, 0, sticks) == -32768);
   assert(openretro_party_input(RETRO_DEVICE_ANALOG, 1, 1, 0, sticks) == -16000);
   assert(openretro_party_input(RETRO_DEVICE_ANALOG, RETRO_DEVICE_INDEX_ANALOG_BUTTON, RETRO_DEVICE_ID_JOYPAD_A, buttons, neutral) == 32767);
   assert(openretro_party_input(RETRO_DEVICE_KEYBOARD, 0, RETROK_UP, buttons, sticks) == 0);
   assert(openretro_party_input(RETRO_DEVICE_MOUSE, 0, 0, buttons, sticks) == 0);
   assert(openretro_party_input(RETRO_DEVICE_JOYPAD, 0, 255, buttons, sticks) == 0);
   puts("Party input isolation: focus ownership, neutral, buttons, masks, sticks and local devices passed.");
   return 0;
}
