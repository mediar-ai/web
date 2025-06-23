'use client';

import React from 'react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export default function AdminPage() {
  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">Admin</h1>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
        </div>
      </div>
      
      <div className="container mx-auto py-8">
        <div className="text-center">
          <h2 className="text-lg text-gray-600 mb-4">Admin Dashboard</h2>
          <p className="text-gray-500">Access admin features and user management.</p>
        </div>
      </div>
    </div>
  );
} 