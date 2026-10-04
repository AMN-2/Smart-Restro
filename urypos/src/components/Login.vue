<template>
  <div class="flex min-h-[70vh] flex-col items-center justify-center">
    <div class="w-full max-w-md">
      <!-- Same brand lockup as the header, so the first screen of the shift
           and every screen after it agree on what this product is called. -->
      <div class="mb-6 flex flex-col items-center gap-3">
        <span class="grid h-14 w-14 place-items-center rounded-2xl bg-card shadow-card">
          <img :src="imagePath" alt="" class="h-10 w-10 object-contain" />
        </span>
        <p class="text-xl font-bold tracking-tight text-foreground">
          Smart <strong class="text-primary">Restro</strong>
        </p>
      </div>

      <div class="pos-card px-6 py-8">
        <h1 class="pos-title mb-6 text-center">{{ $t('login.sign_in') }}</h1>

        <form class="space-y-5" @submit.prevent="auth.login">
          <div>
            <label for="userId" class="pos-form-label">{{ $t('login.email') }}</label>
            <div class="pos-search">
              <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path stroke-linecap="round" stroke-linejoin="round" d="m3 7 9 6 9-6" />
              </svg>
              <input
                id="userId"
                name="user_id"
                class="pos-input"
                autocomplete="username"
                autocapitalize="none"
                v-model="auth.userId"
                required
                placeholder="jane@example.com"
              />
            </div>
          </div>

          <div>
            <label for="password" class="pos-form-label">{{ $t('login.password_label') }}</label>
            <div class="pos-search">
              <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2" /><path stroke-linecap="round" d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <input
                id="password"
                :type="auth.showPassword ? 'text' : 'password'"
                name="currentPassword"
                class="pos-input pe-20"
                autocomplete="current-password"
                v-model="auth.currentPassword"
                required
                placeholder="•••••"
              />
              <button
                type="button"
                class="absolute inset-y-0 end-0 flex items-center px-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                @click="auth.showPassword = !auth.showPassword"
              >
                {{ auth.showPassword ? $t('login.hide') : $t('login.show') }}
              </button>
            </div>
          </div>

          <button type="submit" class="pos-btn-primary pos-btn-lg w-full">{{ $t('login.title') }}</button>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { useAuthStore } from "@/stores/Auth.js";
// Shared with the header and the kitchen display.
import smartLogo from "../../../smart_logo.png";

export default {
  setup() {
    return { auth: useAuthStore() };
  },
  data() {
    return { imagePath: smartLogo };
  },
};
</script>
