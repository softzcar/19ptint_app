import { defineStore } from "pinia";

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
    cerrarSesion() {
      this.token = null;
      this.usuario = null;
      localStorage.removeItem("token");
      localStorage.removeItem("usuario");
    },
    actualizarUsuario(usuario) {
      this.usuario = usuario;
      localStorage.setItem("usuario", JSON.stringify(usuario));
    },
  },
});
