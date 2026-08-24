import axios from "axios";
import { useAuthStore } from "../stores/auth.js";

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) config.headers.Authorization = `Bearer ${auth.token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      const auth = useAuthStore();
      auth.cerrarSesion();
    }
    return Promise.reject(err);
  }
);
