import { defineStore } from "pinia";
import { api } from "../lib/api.js";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem("token") || null,
    usuario: JSON.parse(localStorage.getItem("usuario") || "null"),
  }),
  getters: {
    autenticado: (state) => !!state.token,
  },
  actions: {
    iniciarSesion(token, usuario) {
      this.token = token;
      this.usuario = usuario;
      localStorage.setItem("token", token);
      localStorage.setItem("usuario", JSON.stringify(usuario));
    },
    async cerrarSesion() {
      this.token = null;
      this.usuario = null;
      localStorage.removeItem("token");
      localStorage.removeItem("usuario");
      // Login unificado (ver plan): "Salir" acá también tiene que cerrar la
      // sesión compartida (cookie ninesys_session) -- si no, quedaba
      // logueado en clasificador-disenos/system-nesting aunque esta app ya
      // mostrara la pantalla de login. Nunca debe bloquear el logout local
      // si esto falla (sin red, etc.) -- por eso el catch silencioso.
      try {
        await api.post("/auth/logout");
      } catch {
        // no-op
      }
    },
    actualizarUsuario(usuario) {
      this.usuario = usuario;
      localStorage.setItem("usuario", JSON.stringify(usuario));
    },
  },
});
