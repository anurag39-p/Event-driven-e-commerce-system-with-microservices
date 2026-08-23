import { createContext, useContext, useReducer, useEffect, useLayoutEffect, useRef } from 'react';
import { useAuth } from './AuthContext.jsx';

const CartContext = createContext(null);
const LEGACY_CART_KEY = 'cart';

function getUserCartKey(userId) {
  return `cart:${userId}`;
}

function loadCartForUser(userId) {
  const legacyRaw = localStorage.getItem(LEGACY_CART_KEY);
  if (legacyRaw !== null) {
    const userKey = getUserCartKey(userId);
    if (localStorage.getItem(userKey) === null) {
      localStorage.setItem(userKey, legacyRaw);
    }
    localStorage.removeItem(LEGACY_CART_KEY);
  }

  try {
    const stored = localStorage.getItem(getUserCartKey(userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function cartReducer(state, action) {
  switch (action.type) {
    case 'LOAD_CART':
      return action.payload;

    case 'ADD_TO_CART': {
      const { product, quantity = 1 } = action.payload;
      const existing = state.find((item) => item.productId === product._id);

      if (existing) {
        return state.map((item) =>
          item.productId === product._id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }

      return [
        ...state,
        {
          productId: product._id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          quantity,
        },
      ];
    }

    case 'REMOVE_FROM_CART':
      return state.filter((item) => item.productId !== action.payload.productId);

    case 'UPDATE_QUANTITY': {
      const { productId, quantity } = action.payload;
      if (quantity < 1) {
        return state.filter((item) => item.productId !== productId);
      }
      return state.map((item) =>
        item.productId === productId ? { ...item, quantity } : item
      );
    }

    case 'CLEAR_CART':
      return [];

    default:
      return state;
  }
}

export function CartProvider({ children }) {
  const { user, isLoading: authLoading } = useAuth();
  const [items, dispatch] = useReducer(cartReducer, []);

  const loadedUserIdRef = useRef(undefined);

  useLayoutEffect(() => {
    if (authLoading) return;

    const currentUserId = user?.id ?? null;

    if (loadedUserIdRef.current === currentUserId) {
      return;
    }

    if (currentUserId === null) {
      dispatch({ type: 'LOAD_CART', payload: [] });
    } else {
      dispatch({ type: 'LOAD_CART', payload: loadCartForUser(currentUserId) });
    }

    loadedUserIdRef.current = currentUserId;
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const currentUserId = user?.id ?? null;
    if (currentUserId === null) return;
    if (loadedUserIdRef.current !== currentUserId) return;

    localStorage.setItem(getUserCartKey(currentUserId), JSON.stringify(items));
  }, [items, user, authLoading]);

  function addToCart(product, quantity = 1) {
    dispatch({ type: 'ADD_TO_CART', payload: { product, quantity } });
  }

  function removeFromCart(productId) {
    dispatch({ type: 'REMOVE_FROM_CART', payload: { productId } });
  }

  function updateQuantity(productId, quantity) {
    dispatch({ type: 'UPDATE_QUANTITY', payload: { productId, quantity } });
  }

  function clearCart() {
    dispatch({ type: 'CLEAR_CART' });
  }

  const totalItemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        totalItemCount,
        subtotal,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within a CartProvider');
  return context;
}