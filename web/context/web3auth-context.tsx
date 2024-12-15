"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  CHAIN_NAMESPACES,
  IProvider,
  WEB3AUTH_NETWORK,
  IAdapter,
} from "@web3auth/base";
import { EthereumPrivateKeyProvider } from "@web3auth/ethereum-provider";
import { getDefaultExternalAdapters } from "@web3auth/default-evm-adapter";
import { Web3Auth, Web3AuthOptions } from "@web3auth/modal";
import type { UserInfo } from "@web3auth/base";
import RPC from "@/utils/viem-rpc";

import { getOwnedIds } from "@/contract/read-contract";
import { createUser } from "@/actions/create-user";
import { createServer } from "@/actions/create-server";

// Définir le type pour le contexte
interface Web3AuthContextType {
  provider: IProvider | null;
  loggedIn: boolean;
  address: string;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getUserInfo: () => Promise<Partial<UserInfo>>;
  getAccounts: () => Promise<unknown>;
  getBalance: () => Promise<void>;
  signMessage: () => Promise<void>;
  sendTransaction: () => Promise<void>;
}

// Créer le contexte avec une valeur par défaut
const Web3AuthContext = createContext<Web3AuthContextType | undefined>(
  undefined
);

// ID du client Web3Auth
const clientId =
  "BEulStyPu0RIpIwX5HItYvVWBJ5SenMen0cOukB2jai4xGqFCz9Cf51XfNLNRrAiPdJUoARS1x7ort9y-A7r_wI";
// "BOurYQZXf2w2QoOMh0nmJkfohgKTdclRyd8rZp74vxyRScIngmeFVYijnF5WT-J7azww3TrxSFiQks6xYvN7xIg";

const chainConfig = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: "0x2B03",
  rpcTarget: "https://sepolia.shape.network",
  displayName: "Shape Sepolia",
  blockExplorerUrl: "https://explorer-sepolia.shape.network",
  ticker: "ETH",
  tickerName: "Ethereum",
  logo: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
};

const privateKeyProvider = new EthereumPrivateKeyProvider({
  config: { chainConfig },
});

const web3AuthOptions: Web3AuthOptions = {
  clientId,
  web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
  privateKeyProvider,
};

const web3auth = new Web3Auth(web3AuthOptions);

export const Web3AuthProvider = ({ children }: { children: ReactNode }) => {
  const [address, setAddress] = useState<string>("");
  const [provider, setProvider] = useState<IProvider | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const initWeb3Auth = async () => {
      try {
        const adapters = await getDefaultExternalAdapters({
          options: web3AuthOptions,
        });
        adapters.forEach((adapter: IAdapter<unknown>) => {
          web3auth.configureAdapter(adapter);
        });
        await web3auth.initModal();
        setProvider(web3auth.provider);
        console.log("Web3Auth initialized", web3auth.provider);

        if (web3auth.connected) {
          setLoggedIn(true);
          if (web3auth.provider) {
            const address = (await RPC.getAccounts(web3auth.provider)) as [
              string
            ];
            if (address[0]) {
              setAddress(address[0]);
            }
          }
        }
      } catch (error) {
        console.error(error);
      }
    };
    initWeb3Auth();
  }, []);

  const login = async () => {
    const web3authProvider = await web3auth.connect();
    setProvider(web3authProvider);
    setLoggedIn(web3auth.connected);
    if (web3authProvider) {
      const address = (await RPC.getAccounts(web3authProvider)) as [string];
      setAddress(address[0]);
      if (address[0]) {
        await createUser(address[0]);
        const ownedIds = await getOwnedIds(address[0]);
        for (const id of ownedIds) {
          console.log(id);
          await createServer(Number(id));
        }
      }
    }
  };

  const logout = async () => {
    await web3auth.logout();
    setAddress("");
    setProvider(null);
    setLoggedIn(false);
  };

  const getUserInfo = async () => {
    const user = await web3auth.getUserInfo();
    console.log(user);
    return user;
    // uiConsole(user);
  };

  const getAccounts = async () => {
    if (!provider) {
      uiConsole("provider not initialized yet");
      return;
    }
    const address = await RPC.getAccounts(provider);
    console.log(address);
    return address;
    // uiConsole(address);
  };

  const getBalance = async () => {
    if (!provider) {
      uiConsole("provider not initialized yet");
      return;
    }
    const balance = await RPC.getBalance(provider);
    uiConsole(balance);
  };

  const signMessage = async () => {
    if (!provider) {
      uiConsole("provider not initialized yet");
      return;
    }
    const signedMessage = await RPC.signMessage(provider);
    uiConsole(signedMessage);
  };

  const sendTransaction = async () => {
    if (!provider) {
      uiConsole("provider not initialized yet");
      return;
    }
    uiConsole("Sending Transaction...");
    const transactionReceipt = await RPC.sendTransaction(provider);
    uiConsole(transactionReceipt);
  };

  function uiConsole(...args: unknown[]): void {
    const el = document.querySelector("#console>p");
    if (el) {
      el.innerHTML = JSON.stringify(args || {}, null, 2);
      console.log(...args);
    }
  }

  return (
    <Web3AuthContext.Provider
      value={{
        provider,
        loggedIn,
        address,
        login,
        logout,
        getUserInfo,
        getAccounts,
        getBalance,
        signMessage,
        sendTransaction,
      }}
    >
      {children}
    </Web3AuthContext.Provider>
  );
};

export const useWeb3Auth = () => {
  const context = useContext(Web3AuthContext);
  if (!context) {
    throw new Error(
      "useWeb3Auth doit être utilisé à l’intérieur de Web3AuthProvider"
    );
  }
  return context;
};
