import { defineChain } from "viem";

export const shape = defineChain({
  id: 11011,
  name: "Shape Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://sepolia.shape.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://explorer-sepolia.shape.network",
    },
  },
  // contracts: {
  //   multicall3: {
  //     address: "0xcA11bde05977b3631167028862bE2a173976CA11",
  //     blockCreated: 5882,
  //   },
  // },
});
