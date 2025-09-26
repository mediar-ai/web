'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { QuickInvite } from '@/components/admin/QuickInvite';
import { useAuth, useOrganization } from '@clerk/nextjs';
import { ArrowLeft, Mail, Users } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export default function InvitesPage() {
  const { userId: _userId } = useAuth();
  const { organization, membership } = useOrganization();
  const [_pendingInvites, _setPendingInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isAdmin = membership?.role === 'org:owner' || membership?.role === 'org:admin';

  useEffect(() => {
    // Fetch pending invitations
    const fetchInvites = async () => {
      try {
        // This would fetch from your database or Clerk API
        setLoading(false);
      } catch (error) {
        console.error('Failed to fetch invitations:', error);
        setLoading(false);
      }
    };

    if (isMediarOrg && isAdmin) {
      fetchInvites();
    } else {
      setLoading(false);
    }
  }, [isMediarOrg, isAdmin]);

  if (!isMediarOrg || !isAdmin) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <Link href="/settings" className="inline-flex items-center gap-2 font-mono text-sm mb-6 hover:underline">
            <ArrowLeft className="w-4 h-4" />
            Settings
          </Link>
          <div className="border-2 border-black bg-gray-50 p-6">
            <p className="font-mono">Access restricted to Mediar organization administrators.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Breadcrumb */}
        <Link href="/settings" className="inline-flex items-center gap-2 font-mono text-sm mb-6 hover:underline">
          <ArrowLeft className="w-4 h-4" />
          Settings
        </Link>

        {/* Header with org switcher */}
        <PageHeader
          title="Client Invitations"
          subtitle="Send invitations to new clients"
        />

        {/* Quick Invite Section */}
        <QuickInvite />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mt-8">
          <div className="border-2 border-black p-4">
            <div className="flex items-center gap-3">
              <Mail className="w-5 h-5" />
              <div>
                <p className="font-mono text-2xl font-bold">0</p>
                <p className="font-mono text-sm text-gray-600">PENDING</p>
              </div>
            </div>
          </div>
          <div className="border-2 border-black p-4">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5" />
              <div>
                <p className="font-mono text-2xl font-bold">0</p>
                <p className="font-mono text-sm text-gray-600">ACCEPTED</p>
              </div>
            </div>
          </div>
          <div className="border-2 border-black p-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-black"></div>
              <div>
                <p className="font-mono text-2xl font-bold">0</p>
                <p className="font-mono text-sm text-gray-600">THIS WEEK</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Invitations Table */}
        <div className="mt-8 border-2 border-black">
          <div className="p-4 bg-black text-white">
            <h2 className="font-mono font-bold">RECENT INVITATIONS</h2>
          </div>
          <div className="p-4">
            {loading ? (
              <p className="font-mono text-gray-600">Loading...</p>
            ) : _pendingInvites.length > 0 ? (
              <table className="w-full font-mono text-sm">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="text-left p-2">EMAIL</th>
                    <th className="text-left p-2">SENT</th>
                    <th className="text-left p-2">STATUS</th>
                    <th className="text-left p-2">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {_pendingInvites.map((invite) => (
                    <tr key={invite.id} className="border-b border-gray-200">
                      <td className="p-2">{invite.email}</td>
                      <td className="p-2">{invite.sentAt}</td>
                      <td className="p-2">
                        <span className="px-2 py-1 bg-gray-100 text-xs">
                          {invite.status}
                        </span>
                      </td>
                      <td className="p-2">
                        <button className="text-xs underline">RESEND</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="font-mono text-gray-600">No invitations sent yet.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}