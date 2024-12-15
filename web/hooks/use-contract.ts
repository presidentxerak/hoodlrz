import { useWeb3Auth } from "@/context/web3auth-context";
import { useEffect, useState } from "react";
import { createWalletClient, custom, Client, WalletClient } from "viem";
import { publicClient } from "@/contract/public-client";
import { shape } from "viem/chains";
import ABI from "@/abi/HoodlrzVerse.json";

type GetBalanceResponse = {
  balance: number;
  isError: boolean;
};

export function useContract() {
  const { provider, getAccounts } = useWeb3Auth();
  const [client, setClient] = useState<WalletClient>();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      if (provider) {
        const walletClient = createWalletClient({
          transport: custom(provider),
          chain: shape,
        });
        if (walletClient) {
          setClient(walletClient);
        }
        const accounts = (await getAccounts()) as [string];
        if (accounts[0]) {
          setAddress(accounts[0]);
        }
      }
    };
    init();
  }, [provider, getAccounts]);

  const getBalance = async (): Promise<GetBalanceResponse> => {
    if (!client) return { balance: 0, isError: true };
    const balance = await publicClient.readContract({
      address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
      abi: ABI.abi,
      functionName: "balanceOf",
      args: [address],
    });

    console.log(balance);
    return { balance: Number(balance), isError: false };
  };

  return {
    provider,
    client,
    address,
    getBalance,
  };
}
