import { createApp } from "vue";
import { createPinia } from "pinia";
import VueKonva from "vue-konva";
import App from "./App.vue";
import router from "./router/index.js";
import "./style.css";

// Cada despliegue cambia los hashes de los archivos JS y borra los viejos --
// una pestaña abierta desde antes queda con referencias rotas al hacer un
// import() dinámico (ej. el upscale en cliente). Vite dispara este evento en
// ese caso; se recarga una sola vez (flag en sessionStorage evita loop si el
// problema persiste).
window.addEventListener("vite:preloadError", () => {
  if (sessionStorage.getItem("recarga-por-deploy")) return;
  sessionStorage.setItem("recarga-por-deploy", "1");
  window.location.reload();
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(VueKonva);
app.mount("#app");
