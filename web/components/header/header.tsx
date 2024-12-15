"use client";
import { Button } from "../ui/button";
import { useWeb3Auth } from "@/context/web3auth-context";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Header() {
  const { loggedIn, logout, getAccounts } = useWeb3Auth();
  const [address, setAddress] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const handleGetAccounts = async () => {
      const address = (await getAccounts()) as [string];
      if (!address) return;
      setAddress(address[0]);
    };
    if (loggedIn) {
      handleGetAccounts();
    }
  }, [getAccounts, loggedIn]);

  if (!loggedIn) {
    return null;
  }

  const handleLogout = async () => {
    router.push("/");
    await logout();
  };

  return (
    <header className="z-2 fixed top-0 left-0 w-full flex p-4 flex-row">
      <div className="flex ml-auto items-center space-x-2">
        <div>{address}</div>
        <Button onClick={handleLogout}>logout</Button>
      </div>
    </header>
  );
}
