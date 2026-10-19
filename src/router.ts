import { createRouter, createWebHashHistory } from 'vue-router';
import { useSession } from './stores/session';
import LoginView from './ui/LoginView.vue';
import LibraryView from './ui/LibraryView.vue';
import PlayerView from './ui/PlayerView.vue';
import ToolsView from './ui/ToolsView.vue';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/', component: LibraryView },
    { path: '/watch/:id', component: PlayerView, props: true },
    { path: '/tools', component: ToolsView },
  ],
});

router.beforeEach((to) => {
  const s = useSession();
  if (to.path !== '/login' && !s.vault) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.path === '/login' && s.vault) return '/';
});
