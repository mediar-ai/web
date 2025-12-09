'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { use, useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface SearchResult {
  eventId: number;
  timestamp: string;
  appName: string | null;
  keywordMatches: Array<{
    text: string;
    type: string;
    context: string;
  }>;
  cleanValues: {
    textContent: string[];
    formFields: string[];
    buttons: string[];
    links: string[];
    totalValues: number;
  };
  summary: {
    totalTextElements: number;
    totalFormFields: number;
    totalButtons: number;
    totalLinks: number;
    totalUniqueValues: number;
    keywordMatchesCount: number;
  };
}

interface SearchResponse {
  found: boolean;
  keyword: string;
  userId: string;
  results: SearchResult[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    currentPage?: number;
    totalPages?: number;
  };
  meta?: {
    processingTime: number;
    totalValuesExtracted: number;
    resultsReturned: number;
  };
}

interface AnalysisResponse {
  question: string;
  analysis: string;
  searchSummary: {
    keyword: string;
    totalEvents: number;
    timeRange: string;
  };
}

function SearchPageContent({ userId }: { userId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialize state from URL parameters
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [question, setQuestion] = useState(searchParams.get('question') || '');
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AnalysisResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisTimer, setAnalysisTimer] = useState(0);
  const [searchHistory, setSearchHistory] = useState<Array<{keyword: string, timestamp: string, resultCount: number}>>([]);

  // Search parameters - initialize from URL
  const [limit, setLimit] = useState(parseInt(searchParams.get('limit') || '10'));
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [appName, setAppName] = useState(searchParams.get('appName') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'created_at');
  const [sortOrder, setSortOrder] = useState(searchParams.get('sortOrder') || 'desc');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Results display
  const [resultsExpanded, setResultsExpanded] = useState(searchParams.get('expanded') === 'true');

  // Load search history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`search-history-${userId}`);
    if (saved) {
      try {
        setSearchHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load search history:', e);
      }
    }
  }, [userId]);

  // Auto-trigger search if URL has keyword parameter
  useEffect(() => {
    const urlKeyword = searchParams.get('keyword');
    if (urlKeyword && !searchResults && !isSearching) {
      // Only auto-trigger if we have a keyword in URL but no results yet
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Timer for AI analysis
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isAnalyzing) {
      setAnalysisTimer(0);
      interval = setInterval(() => {
        setAnalysisTimer(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAnalyzing]);

  // Update URL with current search state
  const updateURL = (params: Record<string, string>) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));

    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        current.set(key, value);
      } else {
        current.delete(key);
      }
    });

    const search = current.toString();
    const query = search ? `?${search}` : '';
    router.push(`/low-level/${userId}/search${query}`, { scroll: false });
  };

  // Save search history to localStorage
  const saveSearchHistory = (newSearch: {keyword: string, timestamp: string, resultCount: number}) => {
    const updated = [newSearch, ...searchHistory.slice(0, 9)]; // Keep last 10 searches
    setSearchHistory(updated);
    localStorage.setItem(`search-history-${userId}`, JSON.stringify(updated));
  };

  const handleSearch = async () => {
    if (!keyword.trim()) return;

    // Update URL with search parameters
    updateURL({
      keyword: keyword.trim(),
      question: question.trim(),
      limit: limit.toString(),
      startDate,
      endDate,
      appName: appName.trim(),
      sortBy,
      sortOrder,
      expanded: 'false' // Collapse results by default
    });

    setIsSearching(true);
    setSearchResults(null);
    setAiAnalysis(null);
    setResultsExpanded(false); // Collapse results by default

    try {
      // Build URL with all parameters
      const params = new URLSearchParams({
        userId: userId,
        keyword: keyword.trim(),
        limit: limit.toString(),
        format: 'structured',
        sortBy: sortBy,
        sortOrder: sortOrder
      });

      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (appName.trim()) params.append('appName', appName.trim());
      
      const response = await fetch(`/api/search-ui-tree?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      
      const data: SearchResponse = await response.json();
      setSearchResults(data);
      
      // Save to history
      if (data.found) {
        saveSearchHistory({
          keyword,
          timestamp: new Date().toISOString(),
          resultCount: data.results.length
        });
      }
      
      // If there's a follow-up question and we found results, automatically run AI analysis
      if (data.found && question.trim()) {
        setIsSearching(false);
        setIsAnalyzing(true);
        
        try {
          const aiResponse = await fetch('/api/analyze-search-results', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              searchResults: data,
              question: question.trim()
            }),
          });

          if (!aiResponse.ok) {
            throw new Error(`AI analysis failed: ${aiResponse.status}`);
          }

          const aiData = await aiResponse.json();
          setAiAnalysis({
            question: question.trim(),
            analysis: aiData.analysis,
            searchSummary: {
              keyword: data.keyword,
              totalEvents: data.pagination.total,
              timeRange: data.results.length > 0 ? 
                `${formatTimestamp(data.results[data.results.length - 1].timestamp)} - ${formatTimestamp(data.results[0].timestamp)}` : 
                'No events'
            }
          });
          
        } catch (aiError) {
          console.error('AI analysis error:', aiError);
          // TODO: Show error toast
        } finally {
          setIsAnalyzing(false);
        }
      }
      
    } catch (error) {
      console.error('Search error:', error);
      // TODO: Show error toast
    } finally {
      setIsSearching(false);
    }
  };


  const handleQuickSearch = (historyKeyword: string) => {
    setKeyword(historyKeyword);
  };

  const clearFilters = () => {
    setLimit(10);
    setStartDate('');
    setEndDate('');
    setAppName('');
    setSortBy('created_at');
    setSortOrder('desc');
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getTimeRange = (results: SearchResult[]) => {
    if (results.length === 0) return 'No events';
    
    const timestamps = results.map(r => new Date(r.timestamp));
    const earliest = new Date(Math.min(...timestamps.map(d => d.getTime())));
    const latest = new Date(Math.max(...timestamps.map(d => d.getTime())));
    
    if (results.length === 1) {
      return formatTimestamp(results[0].timestamp);
    }
    
    const formatDate = (date: Date) => {
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      
      return date.toLocaleDateString();
    };
    
    return `${formatDate(earliest)} to ${formatDate(latest)}`;
  };

  const getResultsSummary = (results: SearchResult[]) => {
    // Event types (by app)
    const eventTypes: Record<string, number> = {};
    
    // Element types and their match counts
    const elementTypes: Record<string, number> = {};
    const elementMatchCounts: Record<string, number> = {};
    
    results.forEach(result => {
      // Count events by app
      const app = result.appName || 'Unknown App';
      eventTypes[app] = (eventTypes[app] || 0) + 1;
      
      // Count element types and matches
      result.keywordMatches.forEach(match => {
        const type = match.type;
        elementTypes[type] = (elementTypes[type] || 0) + 1;
        elementMatchCounts[type] = (elementMatchCounts[type] || 0) + 1;
      });
    });
    
    return {
      eventTypes,
      elementTypes,
      elementMatchCounts,
      totalEvents: results.length,
      totalMatches: results.reduce((sum, result) => sum + (result.summary.keywordMatchesCount || 0), 0)
    };
  };


  return (
    <div className="space-y-6 p-6">
      {/* Search Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Search across all events
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Keyword to search <span className="text-black">*</span>
              </label>
              <Input
                placeholder="Enter keyword to search (e.g., 'button', 'email', 'corebridge')"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !question.trim() && handleSearch()}
                className="w-full"
              />
            </div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">
                Follow-up question (optional)
              </label>
              <Textarea
                placeholder="Ask AI about the search results (e.g., 'What patterns do you see?', 'Tell me about the applicants', 'What workflows are happening?')"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="w-full"
                rows={3}
              />
            </div>
            
            {/* Advanced Search Options */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    <span className="text-sm font-medium">Advanced Options</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="limit">Results Limit</Label>
                    <Select value={limit.toString()} onValueChange={(value) => setLimit(parseInt(value))}>
                      <SelectTrigger id="limit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 results</SelectItem>
                        <SelectItem value="10">10 results</SelectItem>
                        <SelectItem value="25">25 results</SelectItem>
                        <SelectItem value="50">50 results</SelectItem>
                        <SelectItem value="100">100 results</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="app-name">Filter by App</Label>
                    <Input
                      id="app-name"
                      placeholder="e.g., Gmail, Chrome, Word"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      type="datetime-local"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="end-date">End Date</Label>
                    <Input
                      id="end-date"
                      type="datetime-local"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sort-by">Sort By</Label>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger id="sort-by">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="created_at">Date Created</SelectItem>
                        <SelectItem value="relevance">Relevance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sort-order">Sort Order</Label>
                    <Select value={sortOrder} onValueChange={setSortOrder}>
                      <SelectTrigger id="sort-order">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">Newest First</SelectItem>
                        <SelectItem value="asc">Oldest First</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="flex justify-end pt-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={clearFilters}
                    className="text-xs"
                  >
                    Clear All Filters
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
            
            <Button 
              onClick={handleSearch} 
              disabled={isSearching || isAnalyzing || !keyword.trim()}
              className="w-full"
            >
              {isSearching ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-black border-t-transparent"></div>
                  Searching...
                </div>
              ) : isAnalyzing ? (
                <div className="flex items-center gap-2">
                  <div className="animate-pulse h-4 w-4 bg-black rounded-full"></div>
                  <span>
                    AI Analyzing... {Math.floor(analysisTimer / 60)}:{(analysisTimer % 60).toString().padStart(2, '0')}
                    {analysisTimer > 30 && <span className="text-xs opacity-70 ml-1">(detailed analysis)</span>}
                  </span>
                </div>
              ) : question.trim() ? (
                'Search & Ask AI'
              ) : (
                'Search'
              )}
            </Button>
          </div>
          
          {/* Search History */}
          {searchHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Recent searches:</p>
              <div className="flex flex-wrap gap-2">
                {searchHistory.slice(0, 5).map((search, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickSearch(search.keyword)}
                    className="h-7 text-xs"
                  >
                    {search.keyword} ({search.resultCount})
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Search Results
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Total in database: {searchResults.pagination?.total || 0}</span>
                <span>Showing: {searchResults.results?.length || 0}</span>
                {searchResults.meta?.processingTime && (
                  <span>Processing: {searchResults.meta.processingTime}ms</span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {searchResults.found ? (
              <div className="space-y-4">
                {/* Collapsible Results */}
                <Collapsible open={resultsExpanded} onOpenChange={(expanded) => {
                  setResultsExpanded(expanded);
                  updateURL({ expanded: expanded ? 'true' : 'false' });
                }}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-3 h-auto border border-black rounded-lg">
                      <div className="flex items-center gap-4 text-left">
                        <div className="flex items-center gap-2">
                          <ChevronRight className={`h-4 w-4 transition-transform ${resultsExpanded ? 'rotate-90' : ''}`} />
                          <span className="font-medium">
                            {searchResults.results?.length || 0} of {searchResults.pagination?.total || 0} events
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {getTimeRange(searchResults.results || [])}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {(searchResults.results || []).reduce((sum, result) => sum + (result.summary.keywordMatchesCount || 0), 0)} matches
                        </div>
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent className="pt-4 space-y-4">
                    {/* Summary Analysis Card */}
                    <Card className="border-2 border-black">
                      <CardHeader>
                        <CardTitle className="text-base">Search Summary</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const summary = getResultsSummary(searchResults.results || []);
                          return (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {/* Event Types */}
                              <div className="space-y-3">
                                <h4 className="text-sm font-medium">Event Types</h4>
                                <div className="space-y-1">
                                  {Object.entries(summary.eventTypes)
                                    .sort(([,a], [,b]) => b - a)
                                    .slice(0, 5)
                                    .map(([app, count]) => (
                                      <div key={app} className="flex items-center justify-between text-sm">
                                        <span className="truncate">{app}</span>
                                        <Badge variant="outline" className="ml-2">{count}</Badge>
                                      </div>
                                    ))}
                                  {Object.keys(summary.eventTypes).length > 5 && (
                                    <div className="text-xs text-muted-foreground">
                                      +{Object.keys(summary.eventTypes).length - 5} more apps
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Element Types */}
                              <div className="space-y-3">
                                <h4 className="text-sm font-medium">Element Types</h4>
                                <div className="space-y-1">
                                  {Object.entries(summary.elementTypes)
                                    .sort(([,a], [,b]) => b - a)
                                    .map(([type, count]) => (
                                      <div key={type} className="flex items-center justify-between text-sm">
                                        <span className="truncate">{type}</span>
                                        <Badge variant="outline" className="ml-2">{count}</Badge>
                                      </div>
                                    ))}
                                </div>
                              </div>
                              
                              {/* Match Distribution */}
                              <div className="space-y-3">
                                <h4 className="text-sm font-medium">Matches per Type</h4>
                                <div className="space-y-1">
                                  {Object.entries(summary.elementMatchCounts)
                                    .sort(([,a], [,b]) => b - a)
                                    .map(([type, matches]) => (
                                      <div key={type} className="flex items-center justify-between text-sm">
                                        <span className="truncate">{type}</span>
                                        <Badge variant="outline" className="ml-2">{matches} matches</Badge>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                    
                    {/* Results Summary */}
                    <div className="flex items-center gap-4 p-3 border border-black rounded-lg">
                      <Badge variant="outline">
                        Keyword: {searchResults.keyword}
                      </Badge>
                      <Badge variant="outline">
                        Displaying: {searchResults.results?.length || 0} of {searchResults.pagination?.total || 0} total
                      </Badge>
                      <Badge variant="outline">
                        Total matches: {(searchResults.results || []).reduce((sum, result) => sum + (result.summary.keywordMatchesCount || 0), 0)}
                      </Badge>
                    </div>
                    
                    {/* Active Filters */}
                    {(limit !== 10 || startDate || endDate || appName || sortBy !== 'created_at' || sortOrder !== 'desc') && (
                      <div className="flex flex-wrap items-center gap-2 p-3 border border-black rounded-lg">
                        <span className="text-sm font-medium">Filters:</span>
                        {limit !== 10 && (
                          <Badge variant="outline">Limit: {limit}</Badge>
                        )}
                        {appName && (
                          <Badge variant="outline">App: {appName}</Badge>
                        )}
                        {startDate && (
                          <Badge variant="outline">From: {new Date(startDate).toLocaleDateString()}</Badge>
                        )}
                        {endDate && (
                          <Badge variant="outline">To: {new Date(endDate).toLocaleDateString()}</Badge>
                        )}
                        {sortBy !== 'created_at' && (
                          <Badge variant="outline">Sort: {sortBy === 'relevance' ? 'Relevance' : 'Date'}</Badge>
                        )}
                        {sortOrder !== 'desc' && (
                          <Badge variant="outline">Order: {sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</Badge>
                        )}
                      </div>
                    )}

                    {/* Results List */}
                    <div className="space-y-4">
                      {(searchResults.results || []).map((result, index) => (
                        <Card key={result.eventId} className="border-l-4 border-l-black">
                          <CardContent className="pt-4">
                            <div className="space-y-3">
                              {/* Event Header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">Event {index + 1}</Badge>
                                  <span className="text-sm text-muted-foreground">
                                    ID: {result.eventId}
                                  </span>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {formatTimestamp(result.timestamp)}
                                </div>
                              </div>

                              {/* App Info */}
                              {result.appName && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-muted-foreground">App:</span>
                                  <Badge variant="outline">{result.appName}</Badge>
                                </div>
                              )}

                              {/* Keyword Matches */}
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">Found &quot;{searchResults.keyword}&quot; in:</span>
                                  <Badge variant="outline">{result.summary.keywordMatchesCount} matches</Badge>
                                </div>
                                
                                {result.keywordMatches.length > 0 ? (
                                  <div className="space-y-2">
                                    {result.keywordMatches.slice(0, 5).map((match, matchIndex) => (
                                      <div key={matchIndex} className="border border-black rounded p-3">
                                        <div className="flex items-start gap-2">
                                          <Badge variant="outline" className="text-xs">{match.type}</Badge>
                                          <div className="flex-1">
                                            <div className="text-sm font-medium break-words">
                                              {match.text}
                                            </div>
                                            {match.context !== match.text && (
                                              <div className="text-xs text-muted-foreground mt-1">
                                                Context: ...{match.context}...
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {result.keywordMatches.length > 5 && (
                                      <div className="text-xs text-muted-foreground text-center">
                                        ... and {result.keywordMatches.length - 5} more matches
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-sm text-muted-foreground p-3 border border-black rounded">
                                    No direct matches found (keyword may be in nested elements)
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {/* Pagination Info */}
                    {searchResults.pagination.hasMore && (
                      <div className="text-center p-4 text-sm text-muted-foreground">
                        {searchResults.pagination.currentPage && searchResults.pagination.totalPages ? (
                          <>Showing page {searchResults.pagination.currentPage} of {searchResults.pagination.totalPages} (Total: {searchResults.pagination.total} events)</>
                        ) : (
                          <>Showing {searchResults.results?.length || 0} of {searchResults.pagination?.total || 0} events</>
                        )}
                      </div>
                    )}
                    
                    {(searchResults.pagination?.total || 0) > (searchResults.results?.length || 0) && (
                      <div className="text-center p-4 border border-black rounded-lg">
                        <div className="text-sm text-muted-foreground">
                          <div className="font-medium mb-1">
                            {(searchResults.pagination?.total || 0) - (searchResults.results?.length || 0)} more events available
                          </div>
                          <div>
                            Increase &quot;Results Limit&quot; in Advanced Options to see more results
                          </div>
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No results found for &quot;{searchResults.keyword}&quot;
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Results */}
      {aiAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      Question: {aiAnalysis.question}
                    </div>
                    <div className="prose prose-sm max-w-none">
                      <div className="whitespace-pre-wrap border border-black p-4 rounded-lg">
                        {aiAnalysis.analysis}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function SearchPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);

  return (
    <Suspense fallback={<div className="p-6">Loading search...</div>}>
      <SearchPageContent userId={userId} />
    </Suspense>
  );
}