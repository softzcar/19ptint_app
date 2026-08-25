<script setup>
defineProps({
  // 'default': marca teal + texto ink, para fondos claros.
  // 'dark': marca amber + texto blanco, para fondos oscuros (np-ink/np-teal).
  variant: { type: String, default: "default" },
  markOnly: { type: Boolean, default: false },
  size: { type: String, default: "md" }, // sm | md | lg
});

const TAMANOS = {
  sm: { mark: "w-7 h-7 rounded-md text-sm", text: "text-[9px]", textBold: "text-xs" },
  md: { mark: "w-9 h-9 rounded-lg text-base", text: "text-[10px]", textBold: "text-sm" },
  lg: { mark: "w-16 h-16 rounded-2xl text-2xl", text: "text-sm", textBold: "text-xl" },
};
</script>

<template>
  <div class="inline-flex items-center gap-2.5">
    <div
      class="flex items-center justify-center font-black shrink-0"
      :class="[
        TAMANOS[size].mark,
        variant === 'dark' ? 'bg-np-amber text-np-ink' : 'bg-np-teal text-white',
      ]"
    >
      19
    </div>
    <div v-if="!markOnly" class="flex flex-col leading-none">
      <span
        class="font-light uppercase tracking-[0.18em]"
        :class="[TAMANOS[size].text, variant === 'dark' ? 'text-white/70' : 'text-np-ink']"
      >
        nineteen
      </span>
      <span
        class="font-black uppercase tracking-[0.18em]"
        :class="[TAMANOS[size].textBold, variant === 'dark' ? 'text-np-amber' : 'text-np-teal']"
      >
        print
      </span>
    </div>
  </div>
</template>
