import React, { useState, useEffect, useRef } from "react";

interface Message {
  id: number;
  text: string;
  fromUser: boolean;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const messageId = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sendMessage = async () => {
    if (!input.trim()) return;

    // Add user message to chat
    const userMessage: Message = {
      id: messageId.current++,
      text: input,
      fromUser: true,
    };
    setMessages((msgs) => [...msgs, userMessage]);
    setInput("");

    try {
      // Send user message to backend API (which talks to Twilio)
      const response = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await response.json();

      // Add bot reply to chat
      const botMessage: Message = {
        id: messageId.current++,
        text: data.reply,
        fromUser: false,
      };
      setMessages((msgs) => [...msgs, botMessage]);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  // Scroll chat to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div style={{ maxWidth: 400, margin: "auto", padding: 20 }}>
      <div
        style={{
          border: "1px solid #ccc",
          height: 300,
          overflowY: "auto",
          padding: 10,
          marginBottom: 10,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              textAlign: msg.fromUser ? "right" : "left",
              margin: "10px 0",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 15,
                backgroundColor: msg.fromUser ? "#DCF8C6" : "#EEE",
              }}
            >
              {msg.text}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        placeholder="Type your message"
        style={{ width: "calc(100% - 80px)", padding: 8, fontSize: 16 }}
      />
      <button onClick={sendMessage} style={{ width: 60, fontSize: 16 }}>
        Send
      </button>
    </div>
  );
}
