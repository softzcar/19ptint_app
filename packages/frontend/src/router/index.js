import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const routes = [
  { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
  { path: "/", name: "proyectos", component: () => import("../views/ProyectosView.vue") },
  {
    path: "/proyectos/:id",
    name: "proyecto",
    component: () => import("../views/ProyectoDetalleView.vue"),
    props: true,
  },
  {
    path: "/lienzos/:id",
    name: "lienzo",
    component: () => import("../views/LienzoView.vue"),
    props: true,
  },
  {
    path: "/admin/usuarios",
    name: "admin-usuarios",
    component: () => import("../views/AdminUsuariosView.vue"),
  },
  {
    path: "/admin/agentes",
    name: "admin-agentes",
    component: () => import("../views/AdminAgentesView.vue"),
  },
  { path: "/perfil", name: "perfil", component: () => import("../views/PerfilView.vue") },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.name !== "login" && !auth.autenticado) {
    return { name: "login" };
  }
  if (to.name === "login" && auth.autenticado) {
    return { name: "proyectos" };
  }
});

export default router;
