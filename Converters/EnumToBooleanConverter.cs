using System;

namespace TikTokHelper_Electron.Converters
{
    internal class EnumToBooleanConverter
    {
        public static bool Convert(Enum value, string enumString)
        {
            if (string.IsNullOrEmpty(enumString))
            {
                throw new ArgumentException("ExceptionEnumToBooleanConverterParameterMustBeAnEnumName");
            }

            if (!Enum.IsDefined(value.GetType(), value))
            {
                throw new ArgumentException("ExceptionEnumToBooleanConverterValueMustBeAnEnum");
            }

            var enumValue = Enum.Parse(value.GetType(), enumString);

            return enumValue.Equals(value);
        }

        public static Enum ConvertBack(bool value, Type enumType, string enumString)
        {
            if (string.IsNullOrEmpty(enumString))
            {
                throw new ArgumentException("ExceptionEnumToBooleanConverterParameterMustBeAnEnumName");
            }

            return (Enum)Enum.Parse(enumType, enumString);
        }
    }
}
