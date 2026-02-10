export interface FfprobeOutput {
  format: FfprobeFormat;
  streams: FfprobeStream[];
}

export interface FfprobeFormat {
  filename: string;
  nb_streams: number;
  format_name: string;
  format_long_name: string;
  duration: string;
  size: string;
  bit_rate: string;
  tags?: Record<string, string>;
}

export interface FfprobeStream {
  index: number;
  codec_name: string;
  codec_type: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}
