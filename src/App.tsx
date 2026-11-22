import { useEffect, useState } from 'react';
import { AuthView } from './components/AuthView';
import { Workspace } from './components/Workspace';
import { setAuthToken } from './lib/api';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  if (!user) {
    return (
      <AuthView
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onAuthenticated={(authedUser, token) => {
          setAuthToken(token);
          setUser(authedUser);
        }}
      />
    );
  }

  return (
    <Workspace
      initialUser={user}
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((d) => !d)}
      onLogout={() => {
        setAuthToken(null);
        setUser(null);
      }}
    />
  );
}
