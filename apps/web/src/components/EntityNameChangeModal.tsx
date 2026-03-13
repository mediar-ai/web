'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function EntityNameChangeModal() {
  const [needsAck, setNeedsAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/user/entity-ack')
      .then(r => r.json())
      .then(data => {
        console.log('[entity-ack-modal] check:', data);
        if (data.needsAck) setNeedsAck(true);
      })
      .catch(err => console.error('[entity-ack-modal] check failed:', err));
  }, []);

  async function handleAcknowledge() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/user/entity-ack', { method: 'POST' });
      if (res.ok) {
        console.log('[entity-ack-modal] acknowledged');
        setNeedsAck(false);
      }
    } catch (err) {
      console.error('[entity-ack-modal] ack failed:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!needsAck) return null;

  return (
    <Dialog open={needsAck} onOpenChange={() => {}}>
      <DialogContent
        size="sm"
        hideClose
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Company Name Update</DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed">
            Our legal entity name has changed from{' '}
            <strong>Mediar, Inc.</strong> to{' '}
            <strong>Mediar.ai, Inc.</strong>
            <br /><br />
            All existing agreements, terms of service, and obligations remain
            in full effect under the new entity name. This change does not
            affect your account, data, or the services provided to you.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2">
          <Button
            onClick={handleAcknowledge}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? 'Recording...' : 'I Acknowledge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
