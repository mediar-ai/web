import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import MemoizedScrollAreaContent from '../common/MemoizedScrollAreaContent';
import type { ActivityItem } from '../../types';

interface ActivityTabContentProps {
  activityItems: ActivityItem[];
}

const ActivityTabContent: React.FC<ActivityTabContentProps> = ({ activityItems }) => {
  const memoizedActivityContent = useMemo(() => {
    return activityItems.length > 0
      ? (
        <ul className='space-y-3'>
          {activityItems.slice(0, 20).map((item) => {
            if (item.type === 'initial_dump') {
              return (
                <li
                  key={item.id}
                  className='p-3 border rounded-md bg-white text-xs text-black'
                >
                  <p className='font-medium text-[10px] mb-1.5'>
                    {item.timestamp}
                    <span className='ml-2 text-black font-semibold'>
                      Initial Frame Content
                    </span>{' '}
                    <span className='ml-2 text-black text-[9px] dwindling_opacity'>
                      (Frame:{' '}
                      {item.image_id?.split('-change-')[0].substring(11, 19)})
                    </span>{' '}
                  </p>
                  <MemoizedScrollAreaContent 
                    className='whitespace-pre-wrap p-2 bg-gray-100 rounded text-black max-h-40'
                    content={<div className="text-black">{item.raw_content}</div>} 
                  />
                </li>
              );
            } else if (item.type === 'ui_diff') {
              return (
                <li
                  key={item.id}
                  className='p-3 border rounded-md bg-white text-xs text-black'
                >
                  <p className='font-medium text-[10px] mb-1.5'>
                    {item.timestamp}
                    <span className='ml-2 text-black text-[9px] dwindling_opacity'>
                      (Diff:{' '}
                      {item.image1_id?.split('-change-')[0].substring(11, 19)}
                      {' '}
                      vs{' '}
                      {item.image2_id?.split('-change-')[0].substring(11, 19)})
                    </span>
                  </p>
                  <div className='space-y-1'>
                    <div>
                      <strong className='text-black'>Change Detected:</strong>
                      {' '}
                      <span
                        className={item.change_detected === 'yes'
                          ? 'text-black font-semibold'
                          : 'text-black'}
                      >
                        {item.change_detected}
                      </span>
                    </div>{' '}
                    {item.change_detected === 'yes' && (
                      <>
                        {item.change_description && (
                          <div>
                            <strong className='text-black'>Description:</strong>
                            {' '}
                            {item.change_description}
                          </div>
                        )} 
                        {item.identified_change_types &&
                          item.identified_change_types.length > 0 && (
                            <div className='mt-1'>
                              <strong className='text-black'>Types:</strong>
                              {' '}
                              {item.identified_change_types.join(', ')}
                            </div> 
                          )}
                        <div className='mt-1.5 space-y-0.5 pl-2 border-l-2 border-slate-700'>
                          {item.mouse_movement_details && (
                            <div>
                              <strong className='text-black'>Mouse:</strong>
                              {' '}
                              From:{' '}
                              <span className='text-black'>
                                {item.mouse_movement_details.from_object ||
                                  'N/A'}{' '}
                                ({item.mouse_movement_details.from_coordinate ||
                                  'N/A'})
                              </span>{' '}
                              {' -> '}To:{' '}
                              <span className='text-black'>
                                {item.mouse_movement_details.to_object || 'N/A'}
                                {' '}
                                ({item.mouse_movement_details.to_coordinate ||
                                  'N/A'})
                              </span>{' '}
                            </div>
                          )}
                          {item.typing_details && (
                            <div>
                              <strong className='text-black'>Typed:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.typing_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.click_details && (
                            <div>
                              <strong className='text-black'>Clicked:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.click_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.new_window_details && (
                            <div>
                              <strong className='text-black'>
                                Window Change:
                              </strong>{' '}
                              Old:{' '}
                              <span className='text-black'>
                                {item.new_window_details.old_window_name ||
                                  'N/A'}
                              </span>, {' '}
                              New:{' '}
                              <span className='text-black'>
                                {item.new_window_details.new_window_name ||
                                  'N/A'}
                              </span>{' '}
                            </div>
                          )}
                          {item.new_app_details && (
                            <div>
                              <strong className='text-black'>New App:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.new_app_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.scroll_details && (
                            <div>
                              <strong className='text-black'>
                                Scrolled - New Content:
                              </strong>{' '}
                              <span className='text-black'>
                                {item.scroll_details.new_content_summary}
                              </span>
                            </div>
                          )}{' '}
                          {item.other_change_details &&
                            item.other_change_details.map((other, idx) => (
                              <div key={idx}>
                                <strong className='text-black'>
                                  Other ({other.type_description || 'N/A'}):
                                </strong>{' '}
                                <span className='text-black'>
                                  {other.details}
                                </span>{' '}
                              </div>
                            ))}
                        </div>
                        {item.new_content_detected && (
                          <div className='mt-1.5 pt-1 border-t border-slate-700'>
                            <strong className='text-black'>
                              Newly Detected Content:
                            </strong>
                            <MemoizedScrollAreaContent 
                              className='whitespace-pre-wrap p-2 mt-1 bg-gray-100 rounded text-black max-h-40'
                              content={<div className="text-black">{item.new_content_detected}</div>}
                            />
                          </div>
                        )}
                        {item.unidentified_changes_explanation && (
                          <div className='mt-1.5 pt-1 border-t border-slate-700'>
                            <strong className='text-black'>
                              Model Explanation:
                            </strong>{' '}
                            {item.unidentified_changes_explanation}
                          </div>
                        )} 
                      </>
                    )}
                  </div>
                </li>
              );
            }
            return null;
          })}
        </ul>
      )
      : (
        <p className='text-muted-foreground italic p-8 text-center'>
          No activity captured yet. Start recording.
        </p>
      );
  }, [activityItems, MemoizedScrollAreaContent]);
  
  return (
    <Card className='shadow-sm border-0 p-0'>
      <MemoizedScrollAreaContent
        content={memoizedActivityContent}
        className='h-[350px] pr-3 bg-white'
      />
    </Card>
  );
};

export default ActivityTabContent; 