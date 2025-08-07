'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserButton } from '@clerk/nextjs';
import {
    AlertCircle,
    CheckCircle,
    Loader2,
    Mail,
    MessageSquare,
    Send
} from 'lucide-react';
import { useState } from 'react';

interface RequestAccessFormProps {
  userId: string;
}

export default function RequestAccessForm({ userId: _userId }: RequestAccessFormProps) {
  const [ownerEmail, setOwnerEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
    organizationName?: string;
  }>({ type: null, message: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!ownerEmail.trim()) {
      setSubmitStatus({
        type: 'error',
        message: 'Please enter the owner\'s email address'
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus({ type: null, message: '' });

    try {
      const response = await fetch('/api/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ownerEmail: ownerEmail.trim()
        })
      });

      const result = await response.json();

      if (response.ok) {
        setSubmitStatus({
          type: 'success',
          message: `Access request sent successfully to ${result.ownerEmail}`,
          organizationName: result.organizationName
        });
        
        // Clear form on success
        setOwnerEmail('');
      } else {
        setSubmitStatus({
          type: 'error',
          message: result.error || 'Failed to send access request'
        });
      }
    } catch (error) {
      console.error('Error submitting access request:', error);
      setSubmitStatus({
        type: 'error',
        message: 'Network error. Please try again.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTryAgain = () => {
    setSubmitStatus({ type: null, message: '' });
  };

  // Success state
  if (submitStatus.type === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-6">
          <div className="text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-black mb-2">Request Sent!</h1>
            <p className="text-gray-600">
              Your access request has been sent successfully.
            </p>
          </div>

          <Card className="border-black-outline">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-medium text-green-800 mb-2">What happens next?</h3>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• Your request was sent to <strong>{submitStatus.organizationName}</strong></li>
                    <li>• The organization owner will review your request</li>
                    <li>• You&apos;ll receive email notification when approved</li>
                    <li>• You can then access the workflow tools</li>
                  </ul>
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <h4 className="font-medium text-black">Signed in</h4>
                    <p className="text-sm text-gray-600">Manage your account settings</p>
                  </div>
                  <UserButton 
                    afterSignOutUrl="/"
                    appearance={{
                      elements: {
                        avatarBox: "w-10 h-10"
                      }
                    }}
                  />
                </div>
                
                <Button 
                  onClick={handleTryAgain}
                  variant="outline"
                  className="w-full border-black-outline hover:bg-black hover:text-white"
                >
                  Send Another Request
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Form state
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-black mb-2">Request Organization Access</h1>
          <p className="text-gray-600">
            Enter the email address of your organization owner to request access.
          </p>
        </div>

        {/* Main Form */}
        <Card className="border-black-outline">
          <CardHeader>
            <CardTitle className="text-black flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Access Request
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Owner Email */}
              <div className="space-y-2">
                <Label htmlFor="ownerEmail" className="text-sm font-medium text-gray-700">
                  Organization Owner Email *
                </Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@company.com"
                  className="border-black-outline"
                  required
                />
                <p className="text-xs text-gray-500">
                  Enter the email address of your organization owner or administrator
                </p>
              </div>



              {/* Error Alert */}
              {submitStatus.type === 'error' && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-700">
                    {submitStatus.message}
                  </AlertDescription>
                </Alert>
              )}

              {/* Submit Button */}
              <Button 
                type="submit" 
                disabled={isSubmitting || !ownerEmail.trim()}
                className="w-full bg-black text-white hover:bg-gray-800"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Access Request
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Info */}
        <Card className="border-black-outline">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-black">Signed in</h4>
                <p className="text-sm text-gray-600">
                  Manage your account settings
                </p>
              </div>
              <UserButton 
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-10 h-10"
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500">
          <p>
            Need help? Contact support at{' '}
            <a 
              href="mailto:matt@mediar.ai" 
              className="text-black hover:underline"
            >
              matt@mediar.ai
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}