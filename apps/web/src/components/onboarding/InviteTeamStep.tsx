'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mail, X, UserPlus, Check, Loader2 } from 'lucide-react';

interface InviteTeamStepProps {
  invitesSent: number;
  onInviteSent: () => void;
}

export function InviteTeamStep({ invitesSent, onInviteSent }: InviteTeamStepProps) {
  const [emails, setEmails] = useState<string[]>(['']);
  const [sending, setSending] = useState<number | null>(null);
  const [sentEmails, setSentEmails] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});

  const addEmailField = () => {
    if (emails.length < 5) {
      setEmails([...emails, '']);
    }
  };

  const removeEmailField = (index: number) => {
    if (emails.length > 1) {
      const newEmails = emails.filter((_, i) => i !== index);
      setEmails(newEmails);
      const newErrors = { ...errors };
      delete newErrors[index];
      setErrors(newErrors);
    }
  };

  const updateEmail = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);
    // Clear error on edit
    if (errors[index]) {
      const newErrors = { ...errors };
      delete newErrors[index];
      setErrors(newErrors);
    }
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const sendInvite = async (index: number) => {
    const email = emails[index].trim();
    if (!email) return;

    if (!isValidEmail(email)) {
      setErrors({ ...errors, [index]: 'Invalid email' });
      return;
    }

    if (sentEmails.has(email)) {
      setErrors({ ...errors, [index]: 'Already invited' });
      return;
    }

    setSending(index);
    setErrors({ ...errors, [index]: '' });

    try {
      const response = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'org:member' }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrors({ ...errors, [index]: data.error || 'Failed to send invite' });
        return;
      }

      // Success
      setSentEmails(new Set([...sentEmails, email]));
      onInviteSent();
    } catch (err) {
      setErrors({ ...errors, [index]: 'Network error' });
    } finally {
      setSending(null);
    }
  };

  const sendAllInvites = async () => {
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i].trim();
      if (email && isValidEmail(email) && !sentEmails.has(email)) {
        await sendInvite(i);
      }
    }
  };

  const hasValidEmails = emails.some(e => e.trim() && isValidEmail(e.trim()) && !sentEmails.has(e.trim()));

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-mono font-bold text-black">Invite Your Team</h2>
      <p className="text-gray-600">
        Collaboration is better together! Invite teammates to join your organization.
      </p>

      <div className="space-y-3 mt-6">
        {emails.map((email, index) => {
          const isSent = sentEmails.has(email.trim());
          const error = errors[index];

          return (
            <div key={index} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => updateEmail(index, e.target.value)}
                  placeholder="colleague@company.com"
                  disabled={isSent || sending === index}
                  className={`
                    w-full pl-10 pr-4 py-2 border-2 rounded-lg font-mono text-sm
                    focus:outline-none focus:ring-2 focus:ring-black
                    ${isSent ? 'bg-gray-100 border-gray-300 text-gray-500' : 'border-black'}
                    ${error ? 'border-red-500 focus:ring-red-500' : ''}
                  `}
                />
                {isSent && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black" />
                )}
              </div>

              {!isSent && (
                <>
                  <Button
                    type="button"
                    onClick={() => sendInvite(index)}
                    disabled={!email.trim() || sending !== null}
                    className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-300"
                  >
                    {sending === index ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Send'
                    )}
                  </Button>
                  {emails.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeEmailField(index)}
                      className="text-gray-500 hover:text-black"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}

        {emails.map((_, index) => errors[index] && (
          <p key={`error-${index}`} className="text-xs text-red-600 font-mono ml-10">
            {errors[index]}
          </p>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-2">
        {emails.length < 5 && (
          <Button
            type="button"
            variant="outline"
            onClick={addEmailField}
            className="border-2 border-black hover:bg-black hover:text-white"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add Another
          </Button>
        )}

        {hasValidEmails && emails.filter(e => e.trim()).length > 1 && (
          <Button
            type="button"
            onClick={sendAllInvites}
            disabled={sending !== null}
            className="bg-black text-white hover:bg-gray-800"
          >
            Send All
          </Button>
        )}
      </div>

      {invitesSent > 0 && (
        <div className="mt-4 p-3 bg-gray-50 border-2 border-black rounded-lg">
          <p className="text-sm font-mono text-gray-700">
            <strong className="text-black">{invitesSent}</strong> invite{invitesSent > 1 ? 's' : ''} sent!
          </p>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4">
        You can skip this step and invite teammates later from Settings.
      </p>
    </div>
  );
}
