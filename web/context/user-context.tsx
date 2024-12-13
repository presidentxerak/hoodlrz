"use client";
import { createContext, useContext, useState } from "react";

type User = {
  id?: number;
  name?: string;
  email?: string;
  address: string;
};

interface UserContextValue {
  user: User | undefined;
  setUser: React.Dispatch<React.SetStateAction<User | undefined>>;
}

const UserContext = createContext<UserContextValue>({
  user: undefined,
  setUser: () => {},
});

const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | undefined>();

  const value = {
    user: user || undefined,
    setUser,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
};

export { UserContext, UserProvider, useUser };
