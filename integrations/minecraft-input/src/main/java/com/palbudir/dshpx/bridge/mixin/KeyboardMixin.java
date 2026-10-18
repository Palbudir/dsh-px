package com.palbudir.dshpx.bridge.mixin;

import com.palbudir.dshpx.bridge.VirtualInput;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.PreeditEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(KeyboardHandler.class)
public abstract class KeyboardMixin {
  @Inject(method = "keyPress", at = @At("HEAD"), cancellable = true)
  private void key(long window, int action, KeyEvent event, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "charTyped", at = @At("HEAD"), cancellable = true)
  private void character(long window, CharacterEvent event, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "textInput", at = @At("HEAD"), cancellable = true)
  private void text(long window, String text, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "textEditing", at = @At("HEAD"), cancellable = true)
  private void preedit(long window, PreeditEvent event, CallbackInfo ci) {
    if (!VirtualInput.accepts()) ci.cancel();
  }

  @Inject(method = "getClipboard", at = @At("HEAD"), cancellable = true)
  private void clipboard(CallbackInfoReturnable<String> ci) {
    if (VirtualInput.ISOLATED) ci.setReturnValue(VirtualInput.clipboard);
  }

  @Inject(method = "setClipboard", at = @At("HEAD"), cancellable = true)
  private void clipboard(String value, CallbackInfo ci) {
    if (VirtualInput.ISOLATED) {
      VirtualInput.clipboard = value;
      ci.cancel();
    }
  }
}
