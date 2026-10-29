import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Automatically resets window scroll to the top on every route transition.
 * Prevents mobile & desktop users from landing halfway down newly loaded pages.
 */
export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  }, [pathname]);

  return null;
};
