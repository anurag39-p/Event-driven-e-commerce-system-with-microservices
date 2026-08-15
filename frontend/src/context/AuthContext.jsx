import { createContext, useContext, useReducer, useEffect } from 'react';
import { api, setToken, clearToken, getStoredToken } from '../api/client.js';

const AuthContext = createContext(null);

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
};

function authReducer(state, action) {
  switch (action.type) {
    case 'RESTORE_SESSION':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
      };
    case 'LOGOUT':
      return { ...initialState, isLoading: false };
    case 'FINISH_LOADING':
      return { ...state, isLoading: false };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = localStorage.getItem('user');
    if (token && storedUser) {
      dispatch({ type: 'RESTORE_SESSION', payload: { token, user: JSON.parse(storedUser) } });
    } else {
      dispatch({ type: 'FINISH_LOADING' });
    }
  }, []);

  async function login(email, password) {
    const data = await api.post('/users/login', { email, password }).then((res) => res.data);
    setToken(data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    dispatch({ type: 'LOGIN_SUCCESS', payload: { token: data.token, user: data.user } });
    return data;
  }

  async function register(email, password, name) {
    await api.post('/users/register', { email, password, name });
    return login(email, password);
  }

  function logout() {
    clearToken();
    localStorage.removeItem('user');
    dispatch({ type: 'LOGOUT' });
  }

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}