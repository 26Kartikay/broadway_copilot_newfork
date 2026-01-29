import { Replies } from '../state';

export const getMainMenuReply = (text: string = 'What would you like to do now?'): Replies => {
  return [
    {
      reply_type: 'quick_reply',
      reply_text: text,
      buttons: [
        { text: 'Vibe check', id: 'vibe_check' },
        { text: 'Color analysis', id: 'color_analysis' },
        { text: 'Style Studio', id: 'style_studio' },
        { text: 'Fashion Charades', id: 'fashion_quiz' },
        { text: 'This or That', id: 'this_or_that' },
        { text: 'Skin Lab', id: 'skin_lab' },
      ],
    },
  ];
};
