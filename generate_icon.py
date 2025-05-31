from PIL import Image, ImageDraw, ImageFont
import os

def create_icon_base(size):
    """Create a base icon with the specified size and style"""
    # Create a white circle background
    icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    
    # Draw white circle background
    bg_padding = max(1, size // 16)  # Very small padding for the background
    draw.ellipse([(bg_padding, bg_padding), (size-bg_padding, size-bg_padding)], 
                fill='white')
    
    return icon, draw

def create_regular_icon(size, is_dismissed=False):
    """Create a regular icon with 'EZ' text and optional dismissal line"""
    icon, draw = create_icon_base(size)
    
    # Add 'EZ' text in the center
    try:
        # Start with a larger font size and reduce until it fits with minimal padding
        for font_size in range(int(size * 1.1), 4, -1):
            try:
                font = ImageFont.truetype("Arial", font_size)
            except:
                font = ImageFont.load_default()
            
            text = "EZ"
            text_bbox = draw.textbbox((0, 0), text, font=font)
            text_width = text_bbox[2] - text_bbox[0]
            text_height = text_bbox[3] - text_bbox[1]
            
            # Very minimal padding (10% of size or 1px, whichever is larger)
            padding = max(1, size // 10)
            if text_width <= (size - 2*padding) and text_height <= (size - 2*padding):
                break
        
        # Calculate centered position with minimal padding
        x = (size - text_width) / 2 - text_bbox[0]
        y = (size - text_height) / 2 - text_bbox[1]
        
        # Draw blue text with subtle outline
        color = '#0d6efd'  # Bootstrap primary blue
        draw.text((x, y), text, fill=color, font=font, 
                 stroke_width=1, stroke_fill='#0a58ca')
        
    except Exception as e:
        print(f"Warning: Could not add text to icon: {e}")
    
    return icon

def create_dismissed_icon(size):
    """Create a dismissed icon with EZ text and a red diagonal line"""
    # First create the regular EZ icon
    icon = create_regular_icon(size, is_dismissed=False)
    draw = ImageDraw.Draw(icon)
    
    # Draw a single diagonal red line through the EZ text
    line_padding = size // 4
    line_width = max(2, size // 16)  # Even thinner line for better look
    
    # Draw from top-left to bottom-right through the center
    draw.line([(line_padding, line_padding), 
              (size-line_padding, size-line_padding)], 
             fill='#dc3545', width=line_width, joint='curve')
    
    return icon

def main():
    # Create images directory if it doesn't exist
    os.makedirs('images', exist_ok=True)
    
    # Create regular icons
    for size in [16, 32, 48, 128]:
        icon = create_regular_icon(size)
        icon.save(f'images/icon-{size}.png', 'PNG')
        print(f"Created images/icon-{size}.png")
    
    # Create dismissed icons
    for size in [16, 32]:
        icon = create_dismissed_icon(size)
        icon.save(f'images/icon-dismissed-{size}.png', 'PNG')
        print(f"Created images/icon-dismissed-{size}.png")

if __name__ == "__main__":
    main()
