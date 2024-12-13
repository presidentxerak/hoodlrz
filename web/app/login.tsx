"use client";
import { useEffect } from "react";
import { useWeb3Auth } from "@/context/web3auth-context";

export default function Login({ children }: { children: React.ReactNode }) {
  const { login, loggedIn } = useWeb3Auth();

  useEffect(() => {
    const handleLogIn = async () => {
      if (!loggedIn) {
        await login();
      }
    };
    handleLogIn();
  }, [loggedIn, login]);

  return <>{children}</>;
}
