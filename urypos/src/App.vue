<template>
  <Header />

  <!--
    The shell owns the offsets for the fixed chrome, so no screen has to know
    how tall the brand bar is or whether navigation is a bottom bar or a rail.
    The header used to ship its own spacer div for this, which meant the
    bottom chrome had no equivalent and every screen padded itself by hand.
  -->
  <main class="pos-shell">
    <div class="mx-auto w-full max-w-[96rem] px-4 py-4 sm:px-6 sm:py-6">
      <NotificationModal />

      <div v-if="auth.sessionLoading" role="status" aria-live="polite" class="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground">
        <span class="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden="true"></span>
        {{ $t('login.checking_session') }}
      </div>
      <router-view v-else v-slot="{ Component }">
        <transition name="route-fade" mode="out-in">
          <div :key="$route.path" class="min-w-0">
            <component :is="Component" />
          </div>
        </transition>
      </router-view>
    </div>
  </main>

  <Tabs v-if="!auth.sessionLoading" />
</template>

<script>
import { useAuthStore } from "@/stores/Auth.js";
import Tabs from "./components/bottomTabs.vue";
import Header from "./components/Header.vue";
import NotificationModal from "./components/NotificationModal.vue";
import { startLiveFloor } from "./realtime/liveFloor.js";

export default {
  name: "App",
  components: {
    Tabs,
    Header,
    NotificationModal,
  },
  setup() {
    const auth = useAuthStore();
    return { auth };
  },
  mounted() {
    this.auth.fetchUserDetails();
    // Live floor updates for the whole session (tables, open order, log).
    startLiveFloor();
  },
};
</script>
