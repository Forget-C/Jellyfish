import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'

const backendBaseUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
const baseURL = `${backendBaseUrl}/api`

const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 10000,
})

http.interceptors.request.use(
  (config) => {
    // 这里可以注入 token 等信息
    return config
  },
  (error) => Promise.reject(error),
)

http.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  (error) => {
    // 这里可以统一处理错误提示、跳转登录等
    return Promise.reject(error)
  },
)

// 响应拦截器已返回 response.data，此处声明为 Promise<T>
export const get = <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  http.get<T>(url, config) as Promise<T>

export const post = <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
  http.post<T>(url, data, config) as Promise<T>

export const put = <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
  http.put<T>(url, data, config) as Promise<T>

export const del = <T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  http.delete<T>(url, config) as Promise<T>

export default http
