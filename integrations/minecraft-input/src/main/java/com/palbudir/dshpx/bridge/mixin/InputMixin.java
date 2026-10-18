package com.palbudir.dshpx.bridge.mixin;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import com.palbudir.dshpx.bridge.VirtualInput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(InputConstants.class)
public abstract class InputMixin {
  @Inject(method = "isKeyDown(I)Z", at = @At("HEAD"), cancellable = true)
  private static void virtualKey(int key, CallbackInfoReturnable<Boolean> ci) {
    if (VirtualInput.ISOLATED) ci.setReturnValue(VirtualInput.KEYS.contains(key));
  }

  @Inject(
      method = {"grabMouse", "releaseMouse"},
      at = @At("HEAD"),
      cancellable = true)
  private static void noSystemCursor(Window window, double x, double y, CallbackInfo ci) {
    if (VirtualInput.ISOLATED) ci.cancel();
  }
}
