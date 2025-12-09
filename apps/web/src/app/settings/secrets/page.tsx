'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { useOrganization } from '@clerk/nextjs';
import { Key, Plus, Trash2, Eye, EyeOff, Edit2, Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sanitizeSecretName, validateSecretName } from '@/lib/crypto';

interface Secret {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export default function SecretsPage() {
  const { organization } = useOrganization();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (organization) {
      loadSecrets();
    }
  }, [organization]);

  const loadSecrets = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/secrets');
      if (!response.ok) throw new Error('Failed to fetch secrets');
      const data = await response.json();
      setSecrets(data.secrets);
    } catch (err) {
      console.error('Error loading secrets:', err);
      setError('Failed to load secrets');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSecret = async () => {
    if (!formName || !formValue) {
      setError('Name and value are required');
      return;
    }

    if (!validateSecretName(formName)) {
      setError('Secret name must be uppercase alphanumeric with underscores (e.g., GITHUB_TOKEN)');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const response = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          value: formValue,
          description: formDescription,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create secret');
      }

      // Reset form and reload
      setFormName('');
      setFormValue('');
      setFormDescription('');
      setShowNewForm(false);
      setShowValue(false);
      await loadSecrets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSecret = async (id: string, name: string) => {
    if (!confirm(`Delete secret "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/secrets/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete secret');
      await loadSecrets();
    } catch (err) {
      console.error('Error deleting secret:', err);
      alert('Failed to delete secret');
    }
  };

  const handleUpdateSecret = async (id: string) => {
    if (!formValue) {
      setError('Value is required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const response = await fetch(`/api/secrets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: formValue,
          description: formDescription,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update secret');
      }

      // Reset form and reload
      setEditingId(null);
      setFormValue('');
      setFormDescription('');
      setShowValue(false);
      await loadSecrets();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (secret: Secret) => {
    setEditingId(secret.id);
    setFormValue('');
    setFormDescription(secret.description || '');
    setShowValue(false);
    setError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setFormValue('');
    setFormDescription('');
    setShowValue(false);
    setError('');
  };

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
          <PageHeader
            title="Secrets"
            subtitle="Manage encrypted secrets for workflows"
          />

          {/* Info banner */}
          <div className="mb-6 border-2 border-black p-4 bg-gray-50">
            <h3 className="font-mono font-bold text-sm mb-2">HOW SECRETS WORK</h3>
            <ul className="font-mono text-sm space-y-2 list-disc list-inside">
              <li>Secrets are encrypted (AES-256-GCM) and stored securely</li>
              <li>Shared across all workflows in your organization</li>
              <li>Automatically injected into workflow execution context</li>
              <li>Use placeholder syntax: <code className="bg-white px-2 py-0.5 border border-black">{'${GITHUB_TOKEN}'}</code></li>
              <li>Or access directly as variables in workflow steps</li>
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-300">
              <p className="font-mono text-xs text-gray-600">
                Example: Store <code className="bg-white px-1">GITHUB_TOKEN</code> and use it in workflows with <code className="bg-white px-1">{'${GITHUB_TOKEN}'}</code>
              </p>
            </div>
          </div>

          {/* New Secret Button */}
          <div className="mb-6">
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              className="border-2 border-black px-4 py-2 font-mono font-bold hover:bg-black hover:text-white transition-colors flex items-center gap-2"
            >
              {showNewForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showNewForm ? 'CANCEL' : 'NEW SECRET'}
            </button>
          </div>

          {/* New Secret Form */}
          {showNewForm && (
            <div className="mb-6 border-2 border-black p-6 bg-white">
              <h2 className="font-mono font-bold text-lg mb-4">CREATE NEW SECRET</h2>
              {error && (
                <div className="mb-4 p-3 border-2 border-black bg-red-50">
                  <p className="font-mono text-sm text-black">{error}</p>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                    Name (e.g., GITHUB_TOKEN)
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(sanitizeSecretName(e.target.value))}
                    placeholder="MY_API_KEY"
                    className="w-full border-2 border-black px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                    Value
                  </label>
                  <div className="relative">
                    <input
                      type={showValue ? 'text' : 'password'}
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                      placeholder="Enter secret value..."
                      className="w-full border-2 border-black px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-black pr-10"
                    />
                    <button
                      onClick={() => setShowValue(!showValue)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100"
                    >
                      {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="What is this secret used for?"
                    className="w-full border-2 border-black px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateSecret}
                    disabled={saving}
                    className="bg-black text-white px-6 py-2 font-mono font-bold hover:bg-gray-800 disabled:bg-gray-400 flex items-center gap-2"
                  >
                    {saving ? 'SAVING...' : 'CREATE SECRET'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Secrets List */}
          {loading ? (
            <div className="text-center py-8 font-mono">Loading secrets...</div>
          ) : secrets.length === 0 ? (
            <div className="border-2 border-black p-8 text-center">
              <Key className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="font-mono text-gray-600">No secrets yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {secrets.map((secret) => (
                <div key={secret.id} className="border-2 border-black p-4 bg-white">
                  {editingId === secret.id ? (
                    // Edit mode
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-mono font-bold text-lg">{secret.name}</h3>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdateSecret(secret.id)}
                            disabled={saving}
                            className="border border-black px-3 py-1 font-mono hover:bg-black hover:text-white flex items-center gap-1"
                          >
                            <Check className="w-4 h-4" />
                            SAVE
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="border border-black px-3 py-1 font-mono hover:bg-black hover:text-white flex items-center gap-1"
                          >
                            <X className="w-4 h-4" />
                            CANCEL
                          </button>
                        </div>
                      </div>
                      {error && (
                        <div className="p-3 border-2 border-black bg-red-50">
                          <p className="font-mono text-sm text-black">{error}</p>
                        </div>
                      )}
                      <div>
                        <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                          New Value
                        </label>
                        <div className="relative">
                          <input
                            type={showValue ? 'text' : 'password'}
                            value={formValue}
                            onChange={(e) => setFormValue(e.target.value)}
                            placeholder="Enter new value..."
                            className="w-full border-2 border-black px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-black pr-10"
                          />
                          <button
                            onClick={() => setShowValue(!showValue)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100"
                          >
                            {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                          Description
                        </label>
                        <input
                          type="text"
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          placeholder="What is this secret used for?"
                          className="w-full border-2 border-black px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </div>
                    </div>
                  ) : (
                    // View mode
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <Key className="w-5 h-5" />
                          <h3 className="font-mono font-bold text-lg">{secret.name}</h3>
                        </div>
                        {secret.description && (
                          <p className="font-mono text-sm text-gray-600 mb-2">{secret.description}</p>
                        )}
                        <div className="font-mono text-xs text-gray-500">
                          <p className="bg-gray-100 px-2 py-1 inline-block">Value: ••••••••••••</p>
                        </div>
                        <div className="font-mono text-xs text-gray-400 mt-2">
                          Created {new Date(secret.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEditing(secret)}
                          className="border border-black p-2 hover:bg-black hover:text-white"
                          title="Edit secret"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteSecret(secret.id, secret.name)}
                          className="border border-black p-2 hover:bg-red-600 hover:text-white hover:border-red-600"
                          title="Delete secret"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
