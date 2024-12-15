// // import { Message, UserData } from "@/app/data";
// import ChatTopbar from "./chat-top-bar";
// import { ChatList } from "./chat-list";
// import React, { useEffect, useState } from "react";
// // import useChatStore from "@/hooks/useChatStore";
// import { Message, User, Server } from "@prisma/client";

// interface ChatProps {
//   messages?: Message[];
//   // selectedServer: Server;
//   isMobile: boolean;
// }

// export function Chat({ messages, isMobile }: ChatProps) {
//   // const messagesState = useChatStore((state) => state.messages);

//   const sendMessage = (newMessage: Message) => {
//     // useChatStore.setState((state) => ({
//     //   messages: [...state.messages, newMessage],
//     // }));
//   };

//   return (
//     <div className="flex flex-col justify-between w-full h-full">
//       <ChatTopbar />

//       <ChatList
//         messages={messages || []}
//         // selectedUser={selectedUser}
//         sendMessage={sendMessage}
//         isMobile={isMobile}
//       />
//     </div>
//   );
// }
