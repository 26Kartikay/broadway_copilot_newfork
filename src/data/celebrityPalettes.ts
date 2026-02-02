import { SeasonalPalette } from './seasonalPalettes';

export interface Celebrity {
  name: string;
  imageUrl: string;
}

export const celebrityPalettes: Record<SeasonalPalette, {
  male: Celebrity[];
  female: Celebrity[];
}> = {
  LIGHT_SPRING: {
    male: [
      { name: 'Ranbir Kapoor', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ranbir_Kapoor.jpg' },
      { name: 'Vicky Kaushal', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Vicky_Kaushal_2022.jpg' },
      { name: 'Ishaan Khatter', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ishaan_Khatter.jpg' },
    ],
    female: [
      { name: 'Alia Bhatt', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Alia_Bhatt_2022.jpg' },
      { name: 'Sara Ali Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sara_Ali_Khan.jpg' },
      { name: 'Janhvi Kapoor', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Janhvi_Kapoor.jpg' },
    ],
  },

  WARM_SPRING: {
    male: [
      { name: 'Ranveer Singh', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ranveer_Singh.jpg' },
      { name: 'Ayushmann Khurrana', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ayushmann_Khurrana.jpg' },
      { name: 'Rajkummar Rao', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rajkummar_Rao_2022.jpg' },
    ],
    female: [
      { name: 'Deepika Padukone', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Deepika_Padukone_in_2024.jpg' }, // example from metadata :contentReference[oaicite:0]{index=0}
      { name: 'Kiara Advani', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kiara_Advani_2022.jpg' },
      { name: 'Tara Sutaria', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Tara_Sutaria.jpg' },
    ],
  },

  CLEAR_SPRING: {
    male: [
      { name: 'Shah Rukh Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Shah_Rukh_Khan.jpg' }, // multiple files available :contentReference[oaicite:1]{index=1}
      { name: 'Hrithik Roshan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Hrithik_Roshan_2023.jpg' },
      { name: 'Allu Arjun', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Allu_Arjun_2023.jpg' },
    ],
    female: [
      { name: 'Disha Patani', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Disha_Patani.jpg' },
      { name: 'Katrina Kaif', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Katrina_Kaif.jpg' },
      { name: 'Ananya Panday', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ananya_Panday.jpg' },
    ],
  },

  LIGHT_SUMMER: {
    male: [
      { name: 'Dulquer Salmaan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Dulquer_Salmaan.jpg' },
      { name: 'Aditya Roy Kapur', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Aditya_Roy_Kapur.jpg' },
      { name: 'Siddhant Chaturvedi', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Siddhant_Chaturvedi.jpg' },
    ],
    female: [
      { name: 'Shraddha Kapoor', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Shraddha_Kapoor.jpg' },
      { name: 'Yami Gautam', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Yami_Gautam.jpg' },
      { name: 'Kriti Sanon', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kriti_Sanon.jpg' },
    ],
  },

  COOL_SUMMER: {
    male: [
      { name: 'Farhan Akhtar', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Farhan_Akhtar.jpg' },
      { name: 'Nawazuddin Siddiqui', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Nawazuddin_Siddiqui.jpg' },
      { name: 'Vijay Sethupathi', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Vijay_Sethupathi.jpg' },
    ],
    female: [
      { name: 'Sonam Kapoor', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sonam_Kapoor.jpg' },
      { name: 'Konkona Sen Sharma', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Konkona_Sen_Sharma.jpg' },
      { name: 'Sai Pallavi', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sai_Pallavi.jpg' },
    ],
  },

  SOFT_SUMMER: {
    male: [
      { name: 'Pankaj Tripathi', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Pankaj_Tripathi.jpg' },
      { name: 'Manoj Bajpayee', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Manoj_Bajpayee.jpg' },
      { name: 'Irrfan Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Irrfan_Khan.jpg' },
    ],
    female: [
      { name: 'Vidya Balan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Vidya_Balan.jpg' },
      { name: 'Radhika Apte', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Radhika_Apte.jpg' },
      { name: 'Tabu', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Tabu.jpg' },
    ],
  },

  SOFT_AUTUMN: {
    male: [
      { name: 'Naseeruddin Shah', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Naseeruddin_Shah.jpg' },
      { name: 'Bobby Deol', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Bobby_Deol.jpg' },
      { name: 'Saif Ali Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Saif_Ali_Khan.jpg' },
    ],
    female: [
      { name: 'Kareena Kapoor Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kareena_Kapoor.jpg' },
      { name: 'Rani Mukerji', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rani_Mukerji.jpg' },
      { name: 'Bipasha Basu', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Bipasha_Basu.jpg' },
    ],
  },

  WARM_AUTUMN: {
    male: [
      { name: 'Ajay Devgn', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Ajay_Devgn.jpg' },
      { name: 'Suniel Shetty', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Suniel_Shetty.jpg' },
      { name: 'Dharmendra', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Dharmendra.jpg' },
    ],
    female: [
      { name: 'Kajol', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kajol.jpg' },
      { name: 'Madhuri Dixit', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Madhuri_Dixit.jpg' },
      { name: 'Neetu Singh', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Neetu_Singh.jpg' },
    ],
  },

  DEEP_AUTUMN: {
    male: [
      { name: 'Amitabh Bachchan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Amitabh_Bachchan.jpg' },
      { name: 'Sanjay Dutt', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sanjay_Dutt.jpg' },
      { name: 'Rishi Kapoor', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rishi_Kapoor.jpg' },
    ],
    female: [
      { name: 'Rekha', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rekha.jpg' },
      { name: 'Waheeda_Rehman', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Waheeda_Rehman.jpg' },
      { name: 'Hema_Malini', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Hema_Malini.jpg' },
    ],
  },
  
  COOL_WINTER: {
    male: [
      { name: 'R. Madhavan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/R_Madhavan_2023.jpg' },
      { name: 'Sidharth Malhotra', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sidharth_Malhotra.jpg' },
      { name: 'Aamir Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Aamir_Khan.jpg' },
    ],
    female: [
      { name: 'Aishwarya Rai Bachchan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Aishwarya_Rai.jpg' },
      { name: 'Sushmita Sen', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Sushmita_Sen.jpg' },
      { name: 'Kangana Ranaut', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kangana_Ranaut.jpg' },
    ],
  },

  CLEAR_WINTER: {
    male: [
      { name: 'Shah Rukh Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Shah_Rukh_Khan.jpg' },
      { name: 'Salman Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Salman_Khan.jpg' },
      { name: 'Akshay Kumar', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Akshay_Kumar.jpg' },
    ],
    female: [
      { name: 'Priyanka Chopra Jonas', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Priyanka_Chopra.jpg' },
      { name: 'Katrina Kaif', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Katrina_Kaif.jpg' },
      { name: 'Shruti Haasan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Shruti_Haasan.jpg' },
    ],
  },

  DEEP_WINTER: {
    male: [
      { name: 'Salman Khan', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Salman_Khan.jpg' },
      { name: 'Prabhas', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Prabhas_2023.jpg' },
      { name: 'Yash', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Yash.jpg' },
    ],
    female: [
      { name: 'Rekha', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Rekha.jpg' },
      { name: 'Nayanthara', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Nayanthara.jpg' },
      { name: 'Kajal Aggarwal', imageUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kajal_Aggarwal.jpg' },
    ],
  },
};
