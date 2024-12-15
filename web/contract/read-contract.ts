import { publicClient } from "./public-client";
import ABI from "@/abi/HoodlrzVerse.json";

export async function getOwnerBalance(address: string) {
  const balance = await publicClient.readContract({
    address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
    abi: ABI.abi,
    functionName: "balanceOf",
    args: [address],
  });

  console.log(balance);
  return Number(balance);
}

export async function getOwnedIds(address: string) {
  const balance = await getOwnerBalance(address);

  const ids = [];

  for (let i = 0; i < balance; i++) {
    const id = await publicClient.readContract({
      address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
      abi: ABI.abi,
      functionName: "tokenOfOwnerByIndex",
      args: [address, i],
    });

    ids.push(Number(id));
  }

  return ids;
}

export async function isOwnerOfId(address: string, id: number) {
  const owner = await publicClient.readContract({
    address: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`,
    abi: ABI.abi,
    functionName: "ownerOf",
    args: [id],
  });

  return owner === address;
}
