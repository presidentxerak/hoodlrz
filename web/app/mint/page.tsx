"use client";

import { Button } from "@/components/ui/button";
import { useContract } from "@/hooks/use-contract";
import { useState } from "react";
import { Loader } from "lucide-react";
import { useWeb3Auth } from "@/context/web3auth-context";

export default function Mint() {
  const { address } = useWeb3Auth();
  const [loading, setLoading] = useState(false);
  const { mint } = useContract();

  const handleMint = async () => {
    setLoading(true);
    if (!address) return;
    await mint(address);
    setLoading(false);
  };

  return (
    <div className="flex w-full h-full justify-center items-center">
      <Button onClick={handleMint}>
        {loading ? <Loader className="animate-spin" /> : "Mint"}
      </Button>
    </div>
  );
}
