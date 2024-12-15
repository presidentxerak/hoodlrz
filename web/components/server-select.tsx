"use client";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import { Card, CardHeader, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWeb3Auth } from "@/context/web3auth-context";
import { getOwnedIds } from "@/contract/read-contract";

type ServerSelectProps = {
  servers: {
    id: number;
    name: string;
  }[];
};

export default function ServerSelect({ servers }: ServerSelectProps) {
  const [selectedServer, setSelectedServer] = useState<number>(0);
  const { address } = useWeb3Auth();
  const [ownedIds, setOwnedIds] = useState<number[]>([]);

  useEffect(() => {
    const init = async () => {
      if (address) {
        const ids = await getOwnedIds(address);
        setOwnedIds(ids);
      }
    };
    init();
  }, [address]);

  // const ownedServers = servers.filter((server) => ownedIds.includes(server.id));

  return (
    <Card>
      <CardHeader title="Server Select">
        <p>Select a server to chat with your friends</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4">
          <div className="flex flex-row space-x-2">
            <label htmlFor="server-select" className="flex items-center">
              Server:
            </label>
            <Select onValueChange={(value) => setSelectedServer(Number(value))}>
              <SelectTrigger>
                <SelectValue placeholder="Select a server" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id.toString()}>
                    {server.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Link href={`/server/${selectedServer}`}>
            <Button
              className="w-full"
              disabled={selectedServer == 0 ? true : false}
            >
              Go to Server
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
