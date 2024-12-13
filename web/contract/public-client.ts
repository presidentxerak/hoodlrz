import { createPublicClient, http } from "viem";
import { shape } from "viem/chains";

export const publicClient = createPublicClient({
  chain: shape,
  transport: http("https://sepolia.shape.network"),
});
