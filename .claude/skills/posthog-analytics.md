# Posthog Analytics Skill

Analyze and extract insights from your Posthog dashboard data.

## Setup

1. **Get your Posthog API key:**
   - Go to your Posthog dashboard → Settings → Personal API Keys
   - Create a new personal API key (you provided: `phx_M5E6t8rHuxD9Xc53SEJz6aOBk4qLVfprudlYXI7txJRvESP`)
   - Copy the key for use below

2. **Set environment variables:**
   ```bash
   export POSTHOG_API_KEY="phx_M5E6t8rHuxD9Xc53SEJz6aOBk4qLVfprudlYXI7txJRvESP"
   export POSTHOG_PROJECT_ID="your-project-id"  # Find this in your Posthog project settings
   export POSTHOG_HOST="https://us.i.posthog.com"  # Or your self-hosted URL
   ```

3. **Verify the key is active:**
   - Check that the personal API key hasn't been revoked
   - Ensure it has the necessary permissions (read access to events, insights, persons)
   - If the key is invalid, create a new one in your Posthog dashboard

**Note:** If you see authentication errors, the API key may need to be regenerated in your Posthog dashboard.

## Capabilities

This skill helps you:
- Fetch and analyze events from your Posthog dashboard
- Query insights, trends, and funnels
- Analyze user behavior patterns
- Generate reports on feature usage
- Identify drop-off points in user flows
- Compare metrics across time periods

## Usage Examples

**"Show me the top 10 events from the last 7 days"**
- Fetches recent events and provides analysis

**"What's my user retention rate this month?"**
- Calculates retention metrics

**"Analyze the conversion funnel for signup flow"**
- Examines funnel data and identifies bottlenecks

**"Compare this week's active users vs last week"**
- Provides week-over-week comparison

**"What features are most used?"**
- Analyzes feature adoption from event data

## Implementation

When activated, I will:
1. Use the Posthog API to fetch relevant data
2. Analyze the data based on your query
3. Provide actionable insights and visualizations
4. Suggest optimizations based on patterns

## API Endpoints Used

- `/api/projects/{project_id}/events` - Event data
- `/api/projects/{project_id}/insights` - Saved insights
- `/api/projects/{project_id}/insights/trend` - Trend analysis
- `/api/projects/{project_id}/insights/funnel` - Funnel analysis
- `/api/projects/{project_id}/persons` - User data

## Notes

- All API calls use the Posthog API key from environment variables
- Data is fetched in real-time from your Posthog instance
- Responses include both raw data and interpreted insights
- Time periods default to last 7 days unless specified
