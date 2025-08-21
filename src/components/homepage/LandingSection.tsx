'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { BarChart, CheckCircle, Shield, Users, Workflow } from 'lucide-react';

export default function LandingSection() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <Workflow className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-black">Mediar</h1>
            </div>
            <div className="flex items-center space-x-4">
              <SignInButton mode="modal">
                <Button variant="outline" className="border-black text-black hover:bg-black hover:text-white">
                  Sign In
                </Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button className="bg-black text-white hover:bg-gray-800">
                  Get Started
                </Button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h2 className="text-4xl md:text-6xl font-bold text-black mb-6">
            Capture, Analyze & 
            <br />
            <span className="text-gray-600">Automate Workflows</span>
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Transform your browser workflows into actionable insights. 
            Record, analyze, and deploy automated workflows with AI-powered intelligence.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <SignUpButton mode="modal">
              <Button size="lg" className="bg-black text-white hover:bg-gray-800 px-8 py-3">
                Get Started
              </Button>
            </SignUpButton>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <h3 className="text-3xl font-bold text-black mb-4">
            Everything you need to optimize workflows
          </h3>
          <p className="text-gray-600 text-lg">
            Powerful tools to capture, analyze, and automate your browser-based processes
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Workflow Capture */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <Workflow className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">Workflow Capture</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Record your browser activities in real-time. Capture screenshots, clicks, 
                form inputs, and navigation patterns automatically.
              </p>
            </CardContent>
          </Card>

          {/* AI Analysis */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <BarChart className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">AI-Powered Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Leverage advanced AI to understand your workflows, identify patterns, 
                and suggest optimizations automatically.
              </p>
            </CardContent>
          </Card>

          {/* Team Collaboration */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">Team Collaboration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Share workflows with your team, collaborate on optimizations, 
                and maintain consistent processes across your organization.
              </p>
            </CardContent>
          </Card>

          {/* Enterprise Security */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">Enterprise Security</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Organization-level access controls, data isolation, and compliance features 
                to keep your workflows secure.
              </p>
            </CardContent>
          </Card>

          {/* Automated Deployment */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <CheckCircle className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">Automated Deployment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Deploy your optimized workflows as automated scripts that can run 
                independently or integrate with your existing systems.
              </p>
            </CardContent>
          </Card>

          {/* Real-time Monitoring */}
          <Card className="border-black-outline hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center mb-4">
                <BarChart className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-black">Real-time Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Monitor workflow performance, track success rates, and get insights 
                into optimization opportunities in real-time.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-black text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to optimize your workflows?
          </h3>
          <p className="text-xl text-gray-300 mb-8">
            Join teams who are already using Mediar to streamline their processes 
            and boost productivity.
          </p>
          <SignUpButton mode="modal">
            <Button size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-black px-8 py-3">
              Get Started
            </Button>
          </SignUpButton>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 bg-black rounded flex items-center justify-center">
                <Workflow className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-gray-600">© 2024 Mediar. All rights reserved.</span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-gray-600">
              <a href="#" className="hover:text-black transition-colors">Privacy</a>
              <a href="#" className="hover:text-black transition-colors">Terms</a>
              <a href="#" className="hover:text-black transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}