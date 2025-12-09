'use client';

import { useState } from 'react';

export function QuickInvite() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send invitation');
      }

      setMessage({ type: 'success', text: `✓ Invitation sent to ${email}` });
      setEmail('');
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to send invitation'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-2 border-black bg-white p-6">
      <h2 className="font-mono font-bold text-xl mb-4">QUICK INVITE</h2>

      {message && (
        <div className={`mb-4 p-3 border-2 font-mono ${
          message.type === 'success'
            ? 'border-black bg-white'
            : 'border-black bg-black text-white font-bold'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="flex-1 p-2 border-2 border-black font-mono focus:outline-none focus:ring-2 focus:ring-black"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className={`px-6 py-2 font-mono font-bold transition-colors ${
            loading
              ? 'bg-gray-200 text-gray-500 border-2 border-gray-400'
              : 'bg-black text-white hover:bg-gray-800'
          }`}
        >
          {loading ? 'SENDING...' : 'INVITE'}
        </button>
      </form>
    </div>
  );
}