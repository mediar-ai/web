// src/lib/eventSummarizer.ts
import type { LowLevelEvent } from '@/types';

// Define specific event data structures and UIElementMetadata locally 
// as they are used for casting the `event.payload.payload.event` which is [key: string]: unknown
// These might need to be refined based on actual event structures if they differ from these assumptions.
interface UIElementMetadata {
  application?: string;
  name?: string;
  role?: string;
}

interface KeyboardEventData {
  key_code: number;
  keys?: string;
  is_key_down?: boolean;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  app_name?: string; // Some events might have app_name directly here
}

interface MouseEventData {
  button?: string;
  event_type?: string;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  app_name?: string;
}

interface ApplicationSwitchEventData {
  from_application?: string;
  to_application?: string;
  switch_method?: string;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  // app_name might not be relevant here or could be to_application
}

interface BrowserTabNavigationEventData {
  title?: string;
  action?: string;
  method?: string;
  browser?: string;
  page_dwell_time_ms?: number;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  app_name?: string; // Typically the browser name or related app
}

interface TextInputCompletedEventData {
  text_value?: string;
  input_method?: string;
  keystroke_count?: number;
  typing_duration_ms?: number;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  app_name?: string;
}

interface ClipboardEventData {
  action?: string;
  format?: string;
  content?: string;
  content_size?: number;
  metadata?: {
    ui_element?: UIElementMetadata;
  };
  app_name?: string;
}

const truncateText = (str: string | undefined, len: number): string => {
  if (!str) return '';
  return str.length > len ? `${str.substring(0, len)}...` : str;
};

export const generateEventSummaryString = (
  event: LowLevelEvent,
  options?: { truncate?: boolean; defaultTruncateLength?: number }
): string => {
  const shouldTruncate = options?.truncate !== false; // Default to true
  const truncateLength = options?.defaultTruncateLength ?? 20;

  // Use a new truncate function that respects the shouldTruncate flag
  const conditionalTruncate = (str: string | undefined, len: number): string => {
    if (!str) return '';
    if (!shouldTruncate) return str;
    return str.length > len ? `${str.substring(0, len)}...` : str;
  };

  const nestedPayload = event.payload?.payload;

  if (!nestedPayload) {
    return `Error: Event ID ${event.id} has missing nested payload structure.`;
  }

  const eventType = nestedPayload.type ?? 'unknown_event_type';
  const eventData = nestedPayload.event as Record<string, unknown>;

  let summary = `Event Type: ${eventType}`;

  const getAppName = (specificEventData: Record<string, unknown>, uiMeta?: UIElementMetadata): string => {
    if (uiMeta?.application && typeof uiMeta.application === 'string') {
      return uiMeta.application;
    }
    if (specificEventData.app_name && typeof specificEventData.app_name === 'string') {
      return specificEventData.app_name;
    }
    if (specificEventData.application && typeof specificEventData.application === 'string') {
      return specificEventData.application;
    }
    if (specificEventData.browser && typeof specificEventData.browser === 'string') {
      return specificEventData.browser;
    }
    return 'Unknown App';
  };

  switch (eventType) {
    case 'keyboard': {
      const keyboardEvent = eventData.keyboard as unknown as KeyboardEventData;
      if (!keyboardEvent) {
        summary = 'Keyboard event with missing data';
        break;
      }
      const key = typeof keyboardEvent.keys === 'string' ? keyboardEvent.keys : '';
      const keyCode = typeof keyboardEvent.key_code === 'number' ? keyboardEvent.key_code : 0;
      const keyState = keyboardEvent.is_key_down ? '(down)' : '(up)';
      let keyIdentifier = 'Unknown key';
      if (key) {
        keyIdentifier = key.length > 1 ? key.replace(/([A-Z])/g, ' $1').trim() : key;
      } else if (keyCode) {
        keyIdentifier = String.fromCharCode(keyCode);
      }

      const kbUiElement = keyboardEvent.metadata?.ui_element;
      const kbAppName = getAppName(keyboardEvent as unknown as Record<string, unknown>, kbUiElement);
      const kbElementName = (kbUiElement?.name && typeof kbUiElement.name === 'string') ? kbUiElement.name : '';
      const kbElementRole = (kbUiElement?.role && typeof kbUiElement.role === 'string') ? kbUiElement.role : '';
      
      const kbAppInfo = (kbAppName && kbAppName !== 'Unknown App') ? ` in ${kbAppName}` : '';
      const truncatedKbElementName = conditionalTruncate(kbElementName, truncateLength);

      summary = `Keyboard: ${keyIdentifier} ${keyState}`;
      if (kbElementName) {
        summary += ` on ${kbElementRole ? kbElementRole.toUpperCase() : 'element'} "${truncatedKbElementName}"`;
      }
      summary += kbAppInfo;
      break;
    }

    case 'mouse': {
      const mouseEvent = eventData.mouse as unknown as MouseEventData;
      if (!mouseEvent) {
        summary = 'Mouse event with missing data';
        break;
      }
      const button = (typeof mouseEvent.button === 'string' && mouseEvent.button) ? mouseEvent.button : 'click';
      const eventTypeDisplay = (typeof mouseEvent.event_type === 'string' && mouseEvent.event_type) ? mouseEvent.event_type.toLowerCase() : 'click';

      const mouseUiElement = mouseEvent.metadata?.ui_element;
      const appName = getAppName(mouseEvent as unknown as Record<string, unknown>, mouseUiElement);
      const elementName = (mouseUiElement?.name && typeof mouseUiElement.name === 'string') ? mouseUiElement.name : '<NO NAME>';
      const elementRole = (mouseUiElement?.role && typeof mouseUiElement.role === 'string') ? mouseUiElement.role : 'UNKNOWN';

      // To match ConciseEventView, use untruncated elementName and appName for mouse events.
      summary = `Mouse (event): ${button} (${eventTypeDisplay}) on ${elementRole} "${elementName}" in "${appName}"`;
      break;
    }

    case 'application_switch':
      const appSwitchEvent = eventData as unknown as ApplicationSwitchEventData;
      const fromApp = (typeof appSwitchEvent.from_application === 'string' && appSwitchEvent.from_application) ? appSwitchEvent.from_application : 'Unknown';
      const toApp = (typeof appSwitchEvent.to_application === 'string' && appSwitchEvent.to_application) ? appSwitchEvent.to_application : 'Unknown';
      const switchMethod = (typeof appSwitchEvent.switch_method === 'string' && appSwitchEvent.switch_method) ? appSwitchEvent.switch_method : 'Unknown';
      
      const switchUiElement = appSwitchEvent.metadata?.ui_element;
      const appSwitchElementRole = (switchUiElement?.role && typeof switchUiElement.role === 'string') ? switchUiElement.role : '';
      const appSwitchElementName = (switchUiElement?.name && typeof switchUiElement.name === 'string') ? switchUiElement.name : '';

      const truncatedFromApp = truncateText(fromApp, 30); 
      const truncatedToApp = truncateText(toApp, 30);
      const truncatedAppSwitchElementName = truncateText(appSwitchElementName, truncateLength);

      summary = `App Switch: from ${truncatedFromApp} to ${truncatedToApp} by method: ${switchMethod}`;
      if (appSwitchElementRole) {
        summary += ` on role ${appSwitchElementRole.toUpperCase()}`;
      }
      if (appSwitchElementName) {
        summary += ` "${truncatedAppSwitchElementName}"`;
      }
      break;

    case 'browser_tab_navigation':
      const navEvent = eventData as unknown as BrowserTabNavigationEventData;
      const title = (typeof navEvent.title === 'string' && navEvent.title) ? navEvent.title : 'Unknown Tab';
      const action = (typeof navEvent.action === 'string' && navEvent.action) ? navEvent.action : 'Unknown Action';
      const method = (typeof navEvent.method === 'string' && navEvent.method) ? navEvent.method : 'Unknown Method';
      const navApp = getAppName(eventData, navEvent.metadata?.ui_element);
      const dwellTime = typeof navEvent.page_dwell_time_ms === 'number' ? navEvent.page_dwell_time_ms : undefined;

      const truncatedNavApp = truncateText(navApp, 30);
      const truncatedNavToTitle = truncateText(title, 30);

      summary = `Browser Nav: in ${truncatedNavApp}, action ${action} to "${truncatedNavToTitle}" via ${method}`;
      if (dwellTime !== undefined) {
        summary += ` (dwell: ${dwellTime}ms)`;
      }
      break;

    case 'text_input_completed':
      const textInputEvent = eventData as unknown as TextInputCompletedEventData;
      const textValue = (typeof textInputEvent.text_value === 'string' && textInputEvent.text_value) ? textInputEvent.text_value : '';
      const inputMethod = (typeof textInputEvent.input_method === 'string' && textInputEvent.input_method) ? textInputEvent.input_method : 'Unknown';
      const keystrokes = (typeof textInputEvent.keystroke_count === 'number' && textInputEvent.keystroke_count) ? textInputEvent.keystroke_count : undefined;
      const duration = (typeof textInputEvent.typing_duration_ms === 'number' && textInputEvent.typing_duration_ms) ? textInputEvent.typing_duration_ms : undefined;

      const tiUiElement = textInputEvent.metadata?.ui_element;
      const tiAppName = getAppName(eventData, tiUiElement);
      const tiElementName = (tiUiElement?.name && typeof tiUiElement.name === 'string') ? tiUiElement.name : '';
      const tiElementRole = (tiUiElement?.role && typeof tiUiElement.role === 'string') ? tiUiElement.role : '';

      const truncatedTextValue = conditionalTruncate(textValue, truncateLength);
      const truncatedTextElementName = conditionalTruncate(tiElementName, truncateLength);

      summary = `Text Input Completed on ${tiElementRole.toUpperCase()} "${truncatedTextElementName}" in "${tiAppName}" with text value "${truncatedTextValue}" through input type "${inputMethod}"`;
      if (keystrokes !== undefined) {
        summary += ` with ${keystrokes} keystrokes`;
      }
      if (duration !== undefined) {
        summary += ` in ${duration}ms`;
      }
      break;

    case 'clipboard':
      const clipboardEvent = eventData as unknown as ClipboardEventData;
      const clipAction = clipboardEvent.action || 'Unknown';
      const clipFormat = clipboardEvent.format || 'Unknown';
      const clipContent = clipboardEvent.content || '';
      const clipSize = clipboardEvent.content_size;

      const clipUiElement = clipboardEvent.metadata?.ui_element;
      const clipAppName = getAppName(eventData, clipUiElement);
      const clipElementName = clipUiElement?.name || '';
      const clipElementRole = clipUiElement?.role || '';

      const truncatedClipContent = conditionalTruncate(clipContent, truncateLength);
      const truncatedClipElementName = conditionalTruncate(clipElementName, truncateLength);

      summary = `Clipboard: "${clipAction}" of "${clipFormat}" "${truncatedClipContent}"`;
      if (clipElementRole || clipElementName || (clipAppName && clipAppName !== 'Unknown App')) {
        summary += ` from ${clipElementRole ? clipElementRole : 'element'} "${truncatedClipElementName}" in "${clipAppName}"`;
      }
      if (clipSize !== undefined) {
        summary += `, content size ${clipSize}`;
      }
      break;

    case 'screenshot_diff':
      const diffData = eventData.screenshot_diff as unknown as { before_timestamp?: string, after_timestamp?: string } | undefined;
      const formatTimestamp = (timestamp: string | undefined) => {
        if (!timestamp) return 'N/A';
        try {
          return new Date(timestamp).toUTCString().slice(17, 25) + " UTC"; // HH:MM:SS UTC
        } catch {
          return 'Invalid Date';
        }
      };
      const before = formatTimestamp(diffData?.before_timestamp);
      const after = formatTimestamp(diffData?.after_timestamp);
      summary = `Screenshot Diff: ${before} vs ${after}`;
      break;

    case 'ui_tree': {
        let appName = 'Unknown App';
        const screenData = eventData.screen as { ui_tree?: string } | undefined;
        if (screenData?.ui_tree) {
          try {
            const parsedUiTree = JSON.parse(screenData.ui_tree);
            if (parsedUiTree?.attributes?.name) {
              appName = parsedUiTree.attributes.name;
            } else if (eventData.app_name && typeof eventData.app_name === 'string') {
              appName = eventData.app_name;
            }
          } catch (e) {
            if (eventData.app_name && typeof eventData.app_name === 'string') {
              appName = eventData.app_name;
            }
            console.warn("Failed to parse UI tree in eventSummarizer:", e);
          }
        } else if (eventData.app_name && typeof eventData.app_name === 'string') {
          appName = eventData.app_name;
        }
        summary = `UI Tree captured for ${appName}`;
        break;
      }

    default:
      const defaultApp = (eventData.app_name || eventData.application) as string | undefined;
      summary = `Event: ${eventType}${defaultApp ? ' in ' + defaultApp : ''}`;
      break;
  }
  const eventRawTimestamp = nestedPayload.timestamp as string;
  let displayTimestampSuffix = '';

  if (eventRawTimestamp) {
    try {
      const date = new Date(eventRawTimestamp);

      // Format to: Month Day, H:MM:SS AM/PM UTC (e.g., Jun 17, 10:42:15 PM UTC)
      const datePart = date.toLocaleDateString('en-US', {
        month: 'short', // Jun
        day: 'numeric', // 17
        timeZone: 'UTC',
      });

      const timePart = date.toLocaleTimeString('en-US', {
        hour: 'numeric', // 10 (not 01-09, but 1-9)
        minute: '2-digit', // 42
        second: '2-digit', // 15
        hour12: true, // PM
        timeZone: 'UTC',
      });

      displayTimestampSuffix = ` ${datePart}, ${timePart} UTC`;
    } catch (e) {
      console.warn(`Failed to format timestamp ${eventRawTimestamp}:`, e);
      displayTimestampSuffix = ' (timestamp error)';
    }
  }

  return summary + displayTimestampSuffix;
};
