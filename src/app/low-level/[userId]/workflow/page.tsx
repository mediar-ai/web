'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, PlusCircle, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"

type Message = {
    id: string;
    sender: 'user' | 'ai';
    text: string;
}

type CanvasContent = {
    title: string;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
}

const initialWorkflows: Record<string, CanvasContent> = {
    'workflow-1': {
        title: 'Customer Onboarding',
        inputs: ['Signed contract PDF from customer email.'],
        outputs: ['New account record created in Salesforce.'],
        steps: [
            'User opens email with subject "Contract Signed: ACME Corp".',
            'User downloads attached "ACME_Corp_Contract.pdf".',
            'User navigates to Salesforce and logs in.',
            'User creates a new Account for "ACME Corp".',
            'User uploads contract PDF to the new account record.',
        ],
        businessLogic: ['A new account record can only be created once a signed contract has been received.', 'The account name must match the name on the contract.'],
    },
    'workflow-2': {
        title: 'Invoice Processing',
        inputs: ['Invoice PDF from accounts@vendor.com'],
        outputs: ['Payment scheduled in billing system.'],
        steps: [
            'User receives invoice email.',
            'User opens invoice attachment.',
            'User enters invoice details into accounting software.',
            'User schedules payment for net 30 days.',
            'User archives invoice.',
        ],
        businessLogic: ['All invoices over $5,000 require manager approval before payment is scheduled.'],
    },
};

const EditableListItem = ({ item, onChange, onRemove }: { item: string, onChange: (value: string) => void, onRemove: () => void }) => (
    <div className="flex items-start gap-2 group">
        <Textarea 
            value={item} 
            onChange={(e) => onChange(e.target.value)}
            className="w-full border-0 p-0 h-auto focus-visible:ring-0 resize-none text-sm"
        />
        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onRemove}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
    </div>
);

export default function WorkflowPage() {
    const [view, setView] = useState<'initial' | 'summary'>('initial');
    const [activeWorkflowId, setActiveWorkflowId] = useState('workflow-1');
    const [workflows, setWorkflows] = useState(initialWorkflows);
    const [isSaving, setIsSaving] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: '1', sender: 'ai', text: "I've identified 2 potential workflows from this session. The first is selected. Which one would you like to refine?" }
    ]);
    const [userInput, setUserInput] = useState('');

    const activeContent = workflows[activeWorkflowId];

    const handleIdentifyWorkflows = () => {
        setView('summary');
    };

    const handleContentChange = (field: keyof CanvasContent, value: string | string[], index?: number) => {
        // Debounced save for textareas
        setIsSaving(true);
        if (typeof value === 'string') {
            setWorkflows(prev => ({
                ...prev,
                [activeWorkflowId]: { ...prev[activeWorkflowId], [field]: value }
            }));
        } else if (Array.isArray(value) && index !== undefined) {
             const newArray = [...(workflows[activeWorkflowId][field] as string[])];
             newArray[index] = value[index];
             setWorkflows(prev => ({
                ...prev,
                [activeWorkflowId]: { ...prev[activeWorkflowId], [field]: newArray }
            }));
        }
        // In a real app, this would trigger a debounced API call
        setTimeout(() => setIsSaving(false), 1000);
    };

    const handleSendMessage = () => {
        if (!userInput.trim()) return;

        const newUserMessage: Message = { id: Date.now().toString(), sender: 'user', text: userInput };
        const aiResponse: Message = { id: (Date.now() + 1).toString(), sender: 'ai', text: "I have updated the canvas based on your instructions. (This is a placeholder response)" };

        setMessages(prev => [...prev, newUserMessage, aiResponse]);
        setUserInput('');
    };

    const handleListChange = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic', index: number, value: string) => {
        const newItems = [...activeContent[field]];
        newItems[index] = value;
        setWorkflows(prev => ({ ...prev, [activeWorkflowId]: { ...activeContent, [field]: newItems } }));
    };
    
    const handleAddItem = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic') => {
        const newItems = [...activeContent[field], `New ${field.slice(0, -1)}...`];
        setWorkflows(prev => ({ ...prev, [activeWorkflowId]: { ...activeContent, [field]: newItems } }));
    };

    const handleRemoveItem = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic', index: number) => {
        const newItems = activeContent[field].filter((_, i) => i !== index);
        setWorkflows(prev => ({ ...prev, [activeWorkflowId]: { ...activeContent, [field]: newItems } }));
    };

    if (view === 'initial') {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <Button size="lg" onClick={handleIdentifyWorkflows}>
                    Identify Workflows
                </Button>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-10rem)] grid grid-cols-3 gap-4">
            {/* AI Assistant Sidebar */}
            <aside className="col-span-1 flex flex-col h-full bg-muted/40 border rounded-lg">
                <div className="p-4 border-b">
                    <h3 className="text-base font-semibold">AI Assistant</h3>
                </div>
                <div className="flex-grow p-4 space-y-4 overflow-y-auto">
                    {messages.map((message) => (
                        <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
                            <div className={`p-3 rounded-lg max-w-[80%] ${message.sender === 'ai' ? 'bg-background border' : 'bg-primary text-primary-foreground'}`}>
                                <p className="text-sm">{message.text}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t bg-background">
                    <div className="relative">
                        <Input 
                            placeholder="Ask AI to edit the canvas..." 
                            className="pr-16" 
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                        />
                        <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Paperclip className="h-4 w-4" /></Button>
                            <Button size="sm" className="h-7" onClick={handleSendMessage}><Send className="h-4 w-4" /></Button>
                        </div>
                    </div>
                </div>
            </aside>
            
            {/* Main Canvas Area */}
            <main className="col-span-2 h-full">
                <Tabs value={activeWorkflowId} onValueChange={setActiveWorkflowId}>
                    <TabsList className="bg-transparent rounded-b-none -mb-px border-b">
                        {Object.keys(workflows).map(id => (
                            <TabsTrigger key={id} value={id}>{workflows[id].title}</TabsTrigger>
                        ))}
                         <TabsTrigger value="workflow-3" disabled>Invoice Processing (Conflict)</TabsTrigger>
                    </TabsList>
                    <div className="border border-t-0 rounded-lg rounded-tl-none p-6 bg-background h-full overflow-y-auto">
                        <div className="flex items-center mb-6">
                           <Textarea 
                                value={activeContent.title}
                                onChange={(e) => handleContentChange('title', e.target.value)}
                                className="text-2xl font-bold border-0 p-0 h-auto focus-visible:ring-0 resize-none"
                            />
                            <span className={`text-xs text-muted-foreground transition-opacity ${isSaving ? 'opacity-100' : 'opacity-0'}`}>
                                Saving...
                            </span>
                        </div>
                        <div className="space-y-8">
                            <div className="space-y-3">
                                <h3 className="text-base font-semibold">Inputs</h3>
                                <ul className="list-disc list-outside pl-5 space-y-2">
                                    {activeContent.inputs.map((item, index) => <li key={index}><EditableListItem item={item} onChange={(v) => handleListChange('inputs', index, v)} onRemove={() => handleRemoveItem('inputs', index)} /></li>)}
                                </ul>
                                <Button variant="ghost" size="sm" onClick={() => handleAddItem('inputs')} className="text-muted-foreground"><PlusCircle className="h-4 w-4 mr-2" />Add Input</Button>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-base font-semibold">Outputs</h3>
                                <ul className="list-disc list-outside pl-5 space-y-2">
                                    {activeContent.outputs.map((item, index) => <li key={index}><EditableListItem item={item} onChange={(v) => handleListChange('outputs', index, v)} onRemove={() => handleRemoveItem('outputs', index)} /></li>)}
                                </ul>
                                <Button variant="ghost" size="sm" onClick={() => handleAddItem('outputs')} className="text-muted-foreground"><PlusCircle className="h-4 w-4 mr-2" />Add Output</Button>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-base font-semibold">Steps</h3>
                                <ol className="list-decimal list-outside pl-5 space-y-2">
                                    {activeContent.steps.map((item, index) => <li key={index}><EditableListItem item={item} onChange={(v) => handleListChange('steps', index, v)} onRemove={() => handleRemoveItem('steps', index)} /></li>)}
                                </ol>
                                <Button variant="ghost" size="sm" onClick={() => handleAddItem('steps')} className="text-muted-foreground"><PlusCircle className="h-4 w-4 mr-2" />Add Step</Button>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-base font-semibold">Business Logic</h3>
                                <ul className="list-disc list-outside pl-5 space-y-2">
                                    {activeContent.businessLogic.map((item, index) => <li key={index}><EditableListItem item={item} onChange={(v) => handleListChange('businessLogic', index, v)} onRemove={() => handleRemoveItem('businessLogic', index)} /></li>)}
                                </ul>
                                <Button variant="ghost" size="sm" onClick={() => handleAddItem('businessLogic')} className="text-muted-foreground"><PlusCircle className="h-4 w-4 mr-2" />Add Item</Button>
                            </div>
                        </div>
                    </div>
                </Tabs>
            </main>
        </div>
    );
} 