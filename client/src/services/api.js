import axios from 'axios'

const api = axios.create({ baseURL: '/api', withCredentials: true })

export function apiErrorMessage(error) {
  const responseMessage = typeof error.response?.data === 'string' ? error.response.data : error.response?.data?.message
  if (error.response?.status === 429) return responseMessage || 'The system is temporarily busy. Please try again shortly.'
  return responseMessage || error.message || 'Something went wrong. Please try again.'
}

export default api
