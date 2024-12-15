"use client";
import { useRouter } from "next/navigation";
import { useWeb3Auth } from "@/context/web3auth-context";

import ChatBottombar from "@/components/chat/chat-bottom-bar";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { DotsVerticalIcon, HeartIcon, Share1Icon } from "@radix-ui/react-icons";
import { Forward, Heart } from "lucide-react";

import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import {
  ChatBubbleAvatar,
  ChatBubbleMessage,
  ChatBubbleTimestamp,
  ChatBubble,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@/components/ui/chat/chat-bubble";
import { AnimatePresence, motion } from "framer-motion";

import { Prisma } from "@prisma/client";

type MessagesWithUser = Prisma.MessageGetPayload<{
  include: {
    user: true;
  };
}>[];

const getMessageVariant = (messageName: string, selectedUserName: string) =>
  messageName == selectedUserName ? "sent" : "received";

export default function DisplayChat({
  messages,
  serverId,
}: {
  messages: MessagesWithUser;
  serverId: number;
}) {
  const { address } = useWeb3Auth();
  const [isMobile, setIsMobile] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop =
          messagesContainerRef.current.scrollHeight;
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const actionIcons = [
    { icon: DotsVerticalIcon, type: "More" },
    { icon: Forward, type: "Like" },
    { icon: Heart, type: "Share" },
  ];

  if (address === "") return <div>loading...</div>;

  return (
    <div className="w-full overflow-y-auto h-full flex flex-col">
      <ChatMessageList ref={messagesContainerRef}>
        <AnimatePresence>
          {messages.map((message, index) => {
            const variant = getMessageVariant(message.user.evmAddress, address);
            console.log("variant", variant);
            console.log("evm addy", message.user.evmAddress);
            console.log("address", address);
            const formattedTime = new Date(
              message.createdAt
            ).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
            return (
              <motion.div
                key={index}
                layout
                initial={{ opacity: 0, scale: 1, y: 50, x: 0 }}
                animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, scale: 1, y: 1, x: 0 }}
                transition={{
                  opacity: { duration: 0.1 },
                  layout: {
                    type: "spring",
                    bounce: 0.3,
                    duration: index * 0.05 + 0.2,
                  },
                }}
                style={{ originX: 0.5, originY: 0.5 }}
                className="flex flex-col gap-2 p-4"
              >
                <ChatBubble variant={variant}>
                  <ChatBubbleAvatar src={message.user.avatarImg} />
                  {/* <ChatBubbleMessage isLoading={message.isLoading}> */}
                  <ChatBubbleMessage>
                    {message.content}
                    {message.createdAt && (
                      <ChatBubbleTimestamp timestamp={formattedTime} />
                    )}
                  </ChatBubbleMessage>
                  <ChatBubbleActionWrapper>
                    {actionIcons.map(({ icon: Icon, type }) => (
                      <ChatBubbleAction
                        className="size-7"
                        key={type}
                        icon={<Icon className="size-4" />}
                        onClick={() =>
                          console.log(
                            "Action " + type + " clicked for message " + index
                          )
                        }
                      />
                    ))}
                  </ChatBubbleActionWrapper>
                </ChatBubble>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </ChatMessageList>
      <ChatBottombar isMobile={isMobile} serverId={serverId.toString()} />
    </div>
  );
}
