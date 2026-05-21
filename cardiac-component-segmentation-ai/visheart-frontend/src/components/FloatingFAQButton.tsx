"use client";

import { useState } from "react";
import { HelpCircle, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export function FloatingFAQButton() {
  const [open, setOpen] = useState(false);
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const resetFeedback = () => {
    setSendStatus(null);
    setSendError(null);
  };

  const closeModal = () => {
    setOpen(false);
    setMessage("");
    resetFeedback();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSendStatus(null);
    setSendError(null);

    const email = senderEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSendError("Please enter a valid email format.");
      return;
    }

    setSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/support/faq-message`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName,
          senderEmail,
          message,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not send your message.");
      }
      setSendStatus("Your message has been sent. We will get back to you soon, so please check your email.");
      setMessage("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not send your message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 inline-flex h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium shadow-lg transition-colors hover:bg-muted"
        aria-label="Open FAQ"
      >
        <HelpCircle className="h-4 w-4" />
        FAQ
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[86vh] w-full max-w-[640px] overflow-y-auto rounded-lg border bg-background shadow-lg">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
              <div>
                <h2 className="text-xl font-bold">FAQ</h2>
                <p className="text-sm text-muted-foreground">Send a question directly to the admin.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeModal} aria-label="Close FAQ">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-5 p-6">
              <form className="space-y-3 rounded-lg border bg-muted/20 p-4" onSubmit={handleSubmit}>
                <div>
                  <h3 className="text-sm font-semibold">Ask the admin</h3>
                  <p className="text-xs text-muted-foreground">
                    Your message will be sent through the backend support endpoint.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Your name"
                    value={senderName}
                    onChange={(event) => {
                      resetFeedback();
                      setSenderName(event.target.value);
                    }}
                  />
                  <Input
                    type="text"
                    inputMode="email"
                    placeholder="Your email"
                    value={senderEmail}
                    onChange={(event) => {
                      resetFeedback();
                      setSenderEmail(event.target.value);
                    }}
                  />
                </div>
                <Textarea
                  placeholder="Write your question..."
                  value={message}
                  onChange={(event) => {
                    resetFeedback();
                    setMessage(event.target.value);
                  }}
                  rows={5}
                  required
                />
                {sendError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {sendError}
                  </div>
                )}
                {sendStatus && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                    {sendStatus}
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button asChild type="button" variant="outline">
                    <a href="/doc">Open User Guide</a>
                  </Button>
                  <Button type="submit" disabled={sending || message.trim().length < 5} className="gap-1.5">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
